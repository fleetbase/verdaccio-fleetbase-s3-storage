import { LocalStorage, Logger, Config, Callback, IPluginStorage, PluginOptions, Token, TokenFilter } from '@verdaccio/legacy-types';
import { getInternalError, VerdaccioError, getServiceUnavailable } from '@verdaccio/commons-api';
import { S3 } from 'aws-sdk';

import { S3Config } from './config';
import S3PackageManager from './s3PackageManager';
import { convertS3Error, is404Error } from './s3Errors';
import addTrailingSlash from './addTrailingSlash';
import getConfigValue from './getConfigValue';

export { S3Config };
export default class S3Database implements IPluginStorage<S3Config> {
    public logger: Logger;
    public config: S3Config;
    private s3: S3;
    private _localData: LocalStorage | null;

    public constructor(config: Config, options: PluginOptions<S3Config>) {
        this.logger = options.logger;
        // copy so we don't mutate
        if (!config) {
            throw new Error('s3 storage missing config. Add `store.s3-storage` to your config file');
        }
        this.config = Object.assign(config, config.store['@fleetbase/verdaccio-fleetbase-s3-storage']);

        if (!this.config.bucket) {
            throw new Error('s3 storage requires a bucket');
        }

        this.logger.debug(
            {
                config: JSON.stringify(
                    {
                        bucket: getConfigValue('AWS_BUCKET', this.config),
                        endpoint: getConfigValue('AWS_ENDPOINT', this.config),
                        region: getConfigValue('AWS_REGION', this.config),
                        accessKeyId: getConfigValue('AWS_ACCESS_KEY_ID', this.config),
                        secretAccessKey: getConfigValue('AWS_SECRET_ACCESS_KEY', this.config),
                    },
                    null,
                    4
                ),
            },
            'S3 ENV/CONFIG VARS: @{config}'
        );

        this.config.bucket = getConfigValue('AWS_BUCKET', this.config);
        this.config.keyPrefix = getConfigValue('AWS_KEY_PREFIX', this.config);
        this.config.endpoint = getConfigValue('AWS_ENDPOINT', this.config);
        this.config.region = getConfigValue('AWS_REGION', this.config);
        this.config.accessKeyId = getConfigValue('AWS_ACCESS_KEY_ID', this.config);
        this.config.secretAccessKey = getConfigValue('AWS_SECRET_ACCESS_KEY', this.config);
        this.config.sessionToken = getConfigValue('AWS_SESSION_TOKEN', this.config);

        const configKeyPrefix = this.config.keyPrefix;
        this._localData = null;
        this.config.keyPrefix = addTrailingSlash(configKeyPrefix);

        // this.logger.debug({ config: JSON.stringify(this.config, null, 4) }, 's3: configuration: @{config}');
        this.s3 = new S3({
            endpoint: this.config.endpoint,
            region: this.config.region,
            s3ForcePathStyle: this.config.s3ForcePathStyle,
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
            sessionToken: this.config.sessionToken,
        });
    }

    public async getSecret(): Promise<string> {
        return Promise.resolve((await this._getData()).secret);
    }

    public async setSecret(secret: string): Promise<void> {
        (await this._getData()).secret = secret;
        await this._sync();
    }

    public add(name: string, callback: Callback): void {
        this.logger.debug({ name }, 's3: [add] private package @{name}');
        this._getData().then(async (data) => {
            if (data.list.indexOf(name) === -1) {
                data.list.push(name);
                this.logger.trace({ name }, 's3: [add] @{name} has been added');
                try {
                    await this._sync();
                    callback(null);
                } catch (err) {
                    callback(err);
                }
            } else {
                callback(null);
            }
        });
    }

    public async search(onPackage: Function, onEnd: Function): Promise<void> {
        this.logger.debug('s3: [search]');
        const storage = await this._getData();
        const storageInfoMap = storage.list.map(this._fetchPackageInfo.bind(this, onPackage));
        this.logger.debug({ l: storageInfoMap.length }, 's3: [search] storageInfoMap length is @{l}');
        await Promise.all(storageInfoMap);
        onEnd();
    }

    private async _fetchPackageInfo(onPackage: Function, packageName: string): Promise<void> {
        const { bucket, keyPrefix } = this.config;
        this.logger.debug({ packageName }, 's3: [_fetchPackageInfo] @{packageName}');
        this.logger.trace({ keyPrefix, bucket }, 's3: [_fetchPackageInfo] bucket: @{bucket} prefix: @{keyPrefix}');
        return new Promise((resolve): void => {
            this.s3.headObject(
                {
                    Bucket: bucket,
                    Key: `${keyPrefix + packageName}/package.json`,
                },
                (err, response) => {
                    if (err) {
                        this.logger.debug({ err }, 's3: [_fetchPackageInfo] error: @{err}');
                        return resolve();
                    }
                    if (response.LastModified) {
                        const { LastModified } = response;
                        this.logger.trace({ LastModified }, 's3: [_fetchPackageInfo] LastModified: @{LastModified}');
                        return onPackage(
                            {
                                name: packageName,
                                path: packageName,
                                time: LastModified.getTime(),
                            },
                            resolve
                        );
                    }
                    resolve();
                }
            );
        });
    }

    public remove(name: string, callback: Callback): void {
        this.logger.debug({ name }, 's3: [remove] @{name}');
        this.get(async (err, data) => {
            if (err) {
                this.logger.error({ err }, 's3: [remove] error: @{err}');
                callback(getInternalError('something went wrong on remove a package'));
            }

            const pkgName = data.indexOf(name);
            if (pkgName !== -1) {
                const data = await this._getData();
                data.list.splice(pkgName, 1);
                this.logger.debug({ pkgName }, 's3: [remove] sucessfully removed @{pkgName}');
            }

            try {
                this.logger.trace('s3: [remove] starting sync');
                await this._sync();
                this.logger.trace('s3: [remove] finish sync');
                callback(null);
            } catch (err) {
                this.logger.error({ err }, 's3: [remove] sync error: @{err}');
                callback(err);
            }
        });
    }

    public get(callback: Callback): void {
        this.logger.debug('s3: [get]');
        this._getData().then((data) => callback(null, data.list));
    }

    public async getAsync(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.get((err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    // Create/write database file to s3
    private async _sync(): Promise<void> {
        await new Promise((resolve, reject): void => {
            const { bucket, keyPrefix } = this.config;
            this.logger.debug({ keyPrefix, bucket }, 's3: [_sync] bucket: @{bucket} prefix: @{keyPrefix}');
            this.s3.putObject(
                {
                    Bucket: this.config.bucket,
                    Key: `${this.config.keyPrefix}verdaccio-s3-db.json`,
                    Body: JSON.stringify(this._localData),
                },
                (err) => {
                    if (err) {
                        this.logger.error({ err }, 's3: [_sync] error: @{err}');
                        reject(err);
                        return;
                    }
                    this.logger.debug('s3: [_sync] sucess');
                    resolve(undefined);
                }
            );
        });
    }

    // returns an instance of a class managing the storage for a single package
    public getPackageStorage(packageName: string): S3PackageManager {
        this.logger.debug({ packageName }, 's3: [getPackageStorage] @{packageName}');

        return new S3PackageManager(this.config, packageName, this.logger);
    }

    private async _getData(): Promise<LocalStorage> {
        if (!this._localData) {
            this._localData = await new Promise((resolve, reject): void => {
                const { bucket, keyPrefix } = this.config;
                this.logger.debug({ keyPrefix, bucket }, 's3: [_getData] bucket: @{bucket} prefix: @{keyPrefix}');
                this.logger.trace('s3: [_getData] get database object');
                this.s3.getObject(
                    {
                        Bucket: bucket,
                        Key: `${keyPrefix}verdaccio-s3-db.json`,
                    },
                    (err, response) => {
                        this.logger.debug({ err: JSON.stringify(err, null, 4), response: JSON.stringify(response, null, 4) }, 's3: [_getData] Err: @{err} Response: @{response}');
                        if (err) {
                            const s3Err: VerdaccioError = convertS3Error(err);
                            this.logger.error({ err: s3Err.message }, 's3: [_getData] err: @{err}');
                            if (is404Error(s3Err)) {
                                this.logger.error('s3: [_getData] err 404 create new database');
                                resolve({ list: [], secret: '' });
                            } else {
                                reject(err);
                            }
                            return;
                        }

                        const body = response.Body ? response.Body.toString() : '';
                        const data = JSON.parse(body);
                        this.logger.debug({ body }, 's3: [_getData] get data @{body}');
                        resolve(data);
                    }
                );
            });
        } else {
            this.logger.trace('s3: [_getData] already exist');
        }

        return this._localData as LocalStorage;
    }

    public saveToken(token: Token): Promise<void> {
        this.logger.warn({ token }, 'save token has not been implemented yet @{token}');

        return Promise.reject(getServiceUnavailable('[saveToken] method not implemented'));
    }

    public deleteToken(user: string, tokenKey: string): Promise<void> {
        this.logger.warn({ tokenKey, user }, 'delete token has not been implemented yet @{user}');

        return Promise.reject(getServiceUnavailable('[deleteToken] method not implemented'));
    }

    public readTokens(filter: TokenFilter): Promise<Token[]> {
        this.logger.warn({ filter }, 'read tokens has not been implemented yet @{filter}');

        return Promise.reject(getServiceUnavailable('[readTokens] method not implemented'));
    }

    public async getComposerJson(packageName: string): Promise<string | null> {
        try {
            const composerJsonKey = this._getPackagePath(packageName, 'composer.json');
            const bucket = this.config.bucket;
            this.logger.debug({ composerJsonKey, bucket }, 's3: [getComposerJson] attempting to get: @{composerJsonKey} from bucket: @{bucket}');

            const data = await this.s3
                .getObject({
                    Bucket: bucket,
                    Key: composerJsonKey,
                })
                .promise();

            const body = data.Body ? data.Body.toString() : '';
            const json = JSON.parse(body);
            this.logger.debug({ json, packageName }, 's3: [getComposerJson] retreived composer json for package: @{packageName} json: @{json}');

            return json;
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [getComposerJson] error @{error}');
            }
            throw error;
        }
    }

    public async getExtensionJson(packageName: string): Promise<string | null> {
        try {
            const extensionJsonKey = this._getPackagePath(packageName, 'extension.json');
            const bucket = this.config.bucket;
            this.logger.debug({ extensionJsonKey, bucket }, 's3: [getExtensionJson] attempting to get: @{extensionJsonKey} from bucket: @{bucket}');

            const data = await this.s3
                .getObject({
                    Bucket: bucket,
                    Key: extensionJsonKey,
                })
                .promise();

            const body = data.Body ? data.Body.toString() : '';
            const json = JSON.parse(body);
            this.logger.debug({ json, packageName }, 's3: [getExtensionJson] retreived extension json for package: @{packageName} json: @{json}');

            return json;
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [getExtensionJson] error @{error}');
            }
            throw error;
        }
    }

    public async getAllExtensionJson(): Promise<any[]> {
        this.logger.debug('s3: [getAllExtensionJson]');
        const extensions = [];

        try {
            const packages = await this.getAsync();
            this.logger.debug({ packages }, 's3: [getAllExtensionJson] found packages: @{packages}');

            await Promise.all(
                packages.map(async (packageName) => {
                    try {
                        const extensionJson = await this.getExtensionJson(packageName);

                        if (extensionJson && typeof extensionJson === 'object') {
                            extensions.push(extensionJson);
                        }
                    } catch (error) {
                        this.logger.error(`Error fetching extension JSON for package ${packageName}: ${error}`);
                    }
                })
            );
        } catch (error) {
            this.logger.error(`Error in getAllExtensionJson: ${error}`);
            throw error;
        }

        return extensions;
    }

    public async getAllComposerJson(): Promise<{ packages: { [packageName: string]: any } }> {
        this.logger.debug('s3: [getAllComposerJson]');
        const composerPackages: { [packageName: string]: any } = {};

        // Use the new getAsync method
        const packages = await this.getAsync();

        this.logger.debug({ packages }, 's3: [getAllComposerJson] found packages: @{packages}');

        // Use Promise.all to wait for all async operations to complete
        await Promise.all(
            packages.map(async (packageName) => {
                const composerJson = await this.getComposerJson(packageName);

                if (composerJson && typeof composerJson === 'object') {
                    const safeComposerJson = composerJson as { [key: string]: any };
                    const composerPackageName = safeComposerJson['name'];
                    const version = safeComposerJson['version'];

                    // add dist
                    const dist = {
                        url: this._getPackageTarballUrl(packageName, version),
                        type: 'tar',
                    };

                    // Initialize package versions object if not already done
                    if (!composerPackages[composerPackageName]) {
                        composerPackages[composerPackageName] = {};
                    }

                    // Add version information
                    composerPackages[composerPackageName][version] = {
                        ...safeComposerJson,
                        dist,
                    };
                }
            })
        );

        return { packages: composerPackages };
    }

    private _getPackagePath(packageName: string, ...additionalPaths: string[]): string {
        let basePackagePath = '';
        const packageAccess = this.config.getMatchedPackagesSpec(packageName);
        if (packageAccess) {
            const storage = packageAccess.storage;
            const packageCustomFolder = addTrailingSlash(storage);
            basePackagePath = `${this.config.keyPrefix}${packageCustomFolder}${packageName}`;
        } else {
            basePackagePath = `${this.config.keyPrefix}${packageName}`;
        }

        // Construct the full path with additional segments
        let fullPath = basePackagePath;
        for (const path of additionalPaths) {
            fullPath = `${addTrailingSlash(fullPath)}${path}`;
        }

        return fullPath;
    }

    private _getPackageTarballUrl(packageName: string, version: string): string {
        let nameWithoutScope = packageName;

        if (packageName.includes('/')) {
            nameWithoutScope = packageName.split('/')[1];
        }

        const fileName = `${nameWithoutScope}-${version}.tgz`;
        const tarballPath = this._getPackagePath(packageName, fileName);
        const signedUrlExpireSeconds = 60 * 30;

        let url = this.s3.getSignedUrl('getObject', {
            Bucket: this.config.bucket,
            Key: tarballPath,
            Expires: signedUrlExpireSeconds,
        });

        // temporarily modify url minio -> localhost
        url = url.replace('minio:', 'localhost:');

        return url;
    }
}
