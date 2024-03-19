"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commons_api_1 = require("@verdaccio/commons-api");
const aws_sdk_1 = require("aws-sdk");
const s3PackageManager_1 = __importDefault(require("./s3PackageManager"));
const s3Errors_1 = require("./s3Errors");
const addTrailingSlash_1 = __importDefault(require("./addTrailingSlash"));
const setConfigValue_1 = __importDefault(require("./setConfigValue"));
class S3Database {
    logger;
    config;
    s3;
    _localData;
    constructor(config, options) {
        this.logger = options.logger;
        // copy so we don't mutate
        if (!config) {
            throw new Error('s3 storage missing config. Add `store.s3-storage` to your config file');
        }
        this.config = Object.assign(config, config.store['@fleetbase/verdaccio-fleetbase-s3-storage']);
        if (!this.config.bucket) {
            throw new Error('s3 storage requires a bucket');
        }
        this.config.bucket = (0, setConfigValue_1.default)(this.config.bucket);
        this.config.keyPrefix = (0, setConfigValue_1.default)(this.config.keyPrefix);
        this.config.endpoint = (0, setConfigValue_1.default)(this.config.endpoint);
        this.config.region = (0, setConfigValue_1.default)(this.config.region);
        this.config.accessKeyId = (0, setConfigValue_1.default)(this.config.accessKeyId);
        this.config.secretAccessKey = (0, setConfigValue_1.default)(this.config.secretAccessKey);
        this.config.sessionToken = (0, setConfigValue_1.default)(this.config.sessionToken);
        const configKeyPrefix = this.config.keyPrefix;
        this._localData = null;
        this.config.keyPrefix = (0, addTrailingSlash_1.default)(configKeyPrefix);
        this.logger.debug({ config: JSON.stringify(this.config, null, 4) }, 's3: configuration: @{config}');
        this.s3 = new aws_sdk_1.S3({
            endpoint: this.config.endpoint,
            region: this.config.region,
            s3ForcePathStyle: this.config.s3ForcePathStyle,
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
            sessionToken: this.config.sessionToken,
        });
    }
    async getSecret() {
        return Promise.resolve((await this._getData()).secret);
    }
    async setSecret(secret) {
        (await this._getData()).secret = secret;
        await this._sync();
    }
    add(name, callback) {
        this.logger.debug({ name }, 's3: [add] private package @{name}');
        this._getData().then(async (data) => {
            if (data.list.indexOf(name) === -1) {
                data.list.push(name);
                this.logger.trace({ name }, 's3: [add] @{name} has been added');
                try {
                    await this._sync();
                    callback(null);
                }
                catch (err) {
                    callback(err);
                }
            }
            else {
                callback(null);
            }
        });
    }
    async search(onPackage, onEnd) {
        this.logger.debug('s3: [search]');
        const storage = await this._getData();
        const storageInfoMap = storage.list.map(this._fetchPackageInfo.bind(this, onPackage));
        this.logger.debug({ l: storageInfoMap.length }, 's3: [search] storageInfoMap length is @{l}');
        await Promise.all(storageInfoMap);
        onEnd();
    }
    async _fetchPackageInfo(onPackage, packageName) {
        const { bucket, keyPrefix } = this.config;
        this.logger.debug({ packageName }, 's3: [_fetchPackageInfo] @{packageName}');
        this.logger.trace({ keyPrefix, bucket }, 's3: [_fetchPackageInfo] bucket: @{bucket} prefix: @{keyPrefix}');
        return new Promise((resolve) => {
            this.s3.headObject({
                Bucket: bucket,
                Key: `${keyPrefix + packageName}/package.json`,
            }, (err, response) => {
                if (err) {
                    this.logger.debug({ err }, 's3: [_fetchPackageInfo] error: @{err}');
                    return resolve();
                }
                if (response.LastModified) {
                    const { LastModified } = response;
                    this.logger.trace({ LastModified }, 's3: [_fetchPackageInfo] LastModified: @{LastModified}');
                    return onPackage({
                        name: packageName,
                        path: packageName,
                        time: LastModified.getTime(),
                    }, resolve);
                }
                resolve();
            });
        });
    }
    remove(name, callback) {
        this.logger.debug({ name }, 's3: [remove] @{name}');
        this.get(async (err, data) => {
            if (err) {
                this.logger.error({ err }, 's3: [remove] error: @{err}');
                callback((0, commons_api_1.getInternalError)('something went wrong on remove a package'));
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
            }
            catch (err) {
                this.logger.error({ err }, 's3: [remove] sync error: @{err}');
                callback(err);
            }
        });
    }
    get(callback) {
        this.logger.debug('s3: [get]');
        this._getData().then((data) => callback(null, data.list));
    }
    async getAsync() {
        return new Promise((resolve, reject) => {
            this.get((err, data) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            });
        });
    }
    // Create/write database file to s3
    async _sync() {
        await new Promise((resolve, reject) => {
            const { bucket, keyPrefix } = this.config;
            this.logger.debug({ keyPrefix, bucket }, 's3: [_sync] bucket: @{bucket} prefix: @{keyPrefix}');
            this.s3.putObject({
                Bucket: this.config.bucket,
                Key: `${this.config.keyPrefix}verdaccio-s3-db.json`,
                Body: JSON.stringify(this._localData),
            }, (err) => {
                if (err) {
                    this.logger.error({ err }, 's3: [_sync] error: @{err}');
                    reject(err);
                    return;
                }
                this.logger.debug('s3: [_sync] sucess');
                resolve(undefined);
            });
        });
    }
    // returns an instance of a class managing the storage for a single package
    getPackageStorage(packageName) {
        this.logger.debug({ packageName }, 's3: [getPackageStorage] @{packageName}');
        return new s3PackageManager_1.default(this.config, packageName, this.logger);
    }
    async _getData() {
        if (!this._localData) {
            this._localData = await new Promise((resolve, reject) => {
                const { bucket, keyPrefix } = this.config;
                this.logger.debug({ keyPrefix, bucket }, 's3: [_getData] bucket: @{bucket} prefix: @{keyPrefix}');
                this.logger.trace('s3: [_getData] get database object');
                this.s3.getObject({
                    Bucket: bucket,
                    Key: `${keyPrefix}verdaccio-s3-db.json`,
                }, (err, response) => {
                    this.logger.debug({ err: JSON.stringify(err, null, 4), response: JSON.stringify(response, null, 4) }, 's3: [_getData] Err: @{err} Response: @{response}');
                    if (err) {
                        const s3Err = (0, s3Errors_1.convertS3Error)(err);
                        this.logger.error({ err: s3Err.message }, 's3: [_getData] err: @{err}');
                        if ((0, s3Errors_1.is404Error)(s3Err)) {
                            this.logger.error('s3: [_getData] err 404 create new database');
                            resolve({ list: [], secret: '' });
                        }
                        else {
                            reject(err);
                        }
                        return;
                    }
                    const body = response.Body ? response.Body.toString() : '';
                    const data = JSON.parse(body);
                    this.logger.debug({ body }, 's3: [_getData] get data @{body}');
                    resolve(data);
                });
            });
        }
        else {
            this.logger.trace('s3: [_getData] already exist');
        }
        return this._localData;
    }
    saveToken(token) {
        this.logger.warn({ token }, 'save token has not been implemented yet @{token}');
        return Promise.reject((0, commons_api_1.getServiceUnavailable)('[saveToken] method not implemented'));
    }
    deleteToken(user, tokenKey) {
        this.logger.warn({ tokenKey, user }, 'delete token has not been implemented yet @{user}');
        return Promise.reject((0, commons_api_1.getServiceUnavailable)('[deleteToken] method not implemented'));
    }
    readTokens(filter) {
        this.logger.warn({ filter }, 'read tokens has not been implemented yet @{filter}');
        return Promise.reject((0, commons_api_1.getServiceUnavailable)('[readTokens] method not implemented'));
    }
    async getComposerJson(packageName) {
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
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [getComposerJson] error @{error}');
            }
            throw error;
        }
    }
    async getExtensionJson(packageName) {
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
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [getExtensionJson] error @{error}');
            }
            throw error;
        }
    }
    async getAllExtensionJson() {
        this.logger.debug('s3: [getAllExtensionJson]');
        const extensions = [];
        try {
            const packages = await this.getAsync();
            this.logger.debug({ packages }, 's3: [getAllExtensionJson] found packages: @{packages}');
            await Promise.all(packages.map(async (packageName) => {
                try {
                    const extensionJson = await this.getExtensionJson(packageName);
                    if (extensionJson && typeof extensionJson === 'object') {
                        extensions.push(extensionJson);
                    }
                }
                catch (error) {
                    this.logger.error(`Error fetching extension JSON for package ${packageName}: ${error}`);
                }
            }));
        }
        catch (error) {
            this.logger.error(`Error in getAllExtensionJson: ${error}`);
            throw error;
        }
        return extensions;
    }
    async getAllComposerJson() {
        this.logger.debug('s3: [getAllComposerJson]');
        const composerPackages = {};
        // Use the new getAsync method
        const packages = await this.getAsync();
        this.logger.debug({ packages }, 's3: [getAllComposerJson] found packages: @{packages}');
        // Use Promise.all to wait for all async operations to complete
        await Promise.all(packages.map(async (packageName) => {
            const composerJson = await this.getComposerJson(packageName);
            if (composerJson && typeof composerJson === 'object') {
                const safeComposerJson = composerJson;
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
        }));
        return { packages: composerPackages };
    }
    _getPackagePath(packageName, ...additionalPaths) {
        let basePackagePath = '';
        const packageAccess = this.config.getMatchedPackagesSpec(packageName);
        if (packageAccess) {
            const storage = packageAccess.storage;
            const packageCustomFolder = (0, addTrailingSlash_1.default)(storage);
            basePackagePath = `${this.config.keyPrefix}${packageCustomFolder}${packageName}`;
        }
        else {
            basePackagePath = `${this.config.keyPrefix}${packageName}`;
        }
        // Construct the full path with additional segments
        let fullPath = basePackagePath;
        for (const path of additionalPaths) {
            fullPath = `${(0, addTrailingSlash_1.default)(fullPath)}${path}`;
        }
        return fullPath;
    }
    _getPackageTarballUrl(packageName, version) {
        let nameWithoutScope = packageName;
        if (packageName.includes('/')) {
            nameWithoutScope = packageName.split('/')[1];
        }
        const fileName = `${nameWithoutScope}-${version}.tgz`;
        const tarballPath = this._getPackagePath(packageName, fileName);
        const signedUrlExpireSeconds = 60 * 5;
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
exports.default = S3Database;
