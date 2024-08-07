import { S3, AWSError } from 'aws-sdk';
import { UploadTarball, ReadTarball } from '@verdaccio/streams';
import { HEADERS, HTTP_STATUS, VerdaccioError } from '@verdaccio/commons-api';
import { Callback, Logger, Package, ILocalPackageManager, CallbackAction, ReadPackageCallback } from '@verdaccio/legacy-types';
import { HttpError } from 'http-errors';

import { is404Error, convertS3Error, create409Error } from './s3Errors';
import { deleteKeyPrefix } from './deleteKeyPrefix';
import { S3Config } from './config';
import axios from 'axios';
import addTrailingSlash from './addTrailingSlash';
import os from 'os';
import tar from 'tar';
import fs from 'fs';
import path from 'path';

const pkgFileName = 'package.json';
const composerFileName = 'composer.json';
const flbFileName = 'extension.json';

export default class S3PackageManager implements ILocalPackageManager {
    public config: S3Config;
    public logger: Logger;
    private readonly packageName: string;
    private readonly s3: S3;
    private readonly packagePath: string;
    private readonly tarballACL: string;

    public constructor(config: S3Config, packageName: string, logger: Logger) {
        this.config = config;
        this.packageName = packageName;
        this.logger = logger;
        const { endpoint, region, s3ForcePathStyle, accessKeyId, secretAccessKey, sessionToken, tarballACL } = config;
        this.tarballACL = tarballACL || 'private';

        this.s3 = new S3({
            endpoint,
            region,
            s3ForcePathStyle,
            accessKeyId,
            secretAccessKey,
            sessionToken,
        });
        this.logger.trace({ packageName }, 's3: [S3PackageManager constructor] packageName @{packageName}');
        this.logger.trace({ endpoint }, 's3: [S3PackageManager constructor] endpoint @{endpoint}');
        this.logger.trace({ region }, 's3: [S3PackageManager constructor] region @{region}');
        this.logger.trace({ s3ForcePathStyle }, 's3: [S3PackageManager constructor] s3ForcePathStyle @{s3ForcePathStyle}');
        this.logger.trace({ tarballACL }, 's3: [S3PackageManager constructor] tarballACL @{tarballACL}');
        this.logger.trace({ accessKeyId }, 's3: [S3PackageManager constructor] accessKeyId @{accessKeyId}');
        this.logger.trace({ secretAccessKey }, 's3: [S3PackageManager constructor] secretAccessKey @{secretAccessKey}');
        this.logger.trace({ sessionToken }, 's3: [S3PackageManager constructor] sessionToken @{sessionToken}');

        const packageAccess = this.config.getMatchedPackagesSpec(packageName);
        if (packageAccess) {
            const storage = packageAccess.storage;
            const packageCustomFolder = addTrailingSlash(storage);
            this.packagePath = `${this.config.keyPrefix}${packageCustomFolder}${this.packageName}`;
        } else {
            this.packagePath = `${this.config.keyPrefix}${this.packageName}`;
        }
    }

    public safePackageName(packageName: string): string {
        return packageName.replace(/[@\/]/g, '-').replace(/^-/, '');
    }

    public getPackagePath(): string {
        return this.packagePath ? this.packagePath : '';
    }

    public updatePackage(name: string, updateHandler: Callback, onWrite: Callback, transformPackage: Function, onEnd: Callback): void {
        this.logger.debug({ name }, 's3: [S3PackageManager updatePackage init] @{name}');
        (async (): Promise<any> => {
            try {
                const json = await this._getData();
                updateHandler(json, (err) => {
                    if (err) {
                        this.logger.error({ err }, 's3: [S3PackageManager updatePackage updateHandler onEnd] @{err}');
                        onEnd(err);
                    } else {
                        const transformedPackage = transformPackage(json);
                        this.logger.debug({ transformedPackage }, 's3: [S3PackageManager updatePackage updateHandler onWrite] @{transformedPackage}');
                        onWrite(name, transformedPackage, onEnd);
                    }
                });
            } catch (err) {
                this.logger.error({ err }, 's3: [S3PackageManager updatePackage updateHandler onEnd catch] @{err}');

                return onEnd(err);
            }
        })();
    }

    private async _getData(): Promise<unknown> {
        this.logger.debug('s3: [S3PackageManager _getData init]');
        this.logger.debug({ pkgFileName }, 's3: [S3PackageManager _getData pkgFileName] @{pkgFileName}');
        this.logger.debug({ key: `${this.packagePath}/${pkgFileName}` }, 's3: [S3PackageManager _getData Key] @{key}');
        return await new Promise((resolve, reject): void => {
            this.s3.getObject(
                {
                    Bucket: this.config.bucket,
                    Key: `${this.packagePath}/${pkgFileName}`,
                },
                (err, response) => {
                    if (err) {
                        this.logger.error({ err: err.message }, 's3: [S3PackageManager _getData] aws @{err}');
                        const error: HttpError = convertS3Error(err);
                        this.logger.error({ error: err.message }, 's3: [S3PackageManager _getData] @{error}');

                        reject(error);
                        return;
                    }
                    const body = response.Body ? response.Body.toString() : '';
                    let data;
                    try {
                        data = JSON.parse(body);
                    } catch (e) {
                        this.logger.error({ body }, 's3: [S3PackageManager _getData] error parsing: @{body}');
                        reject(e);
                        return;
                    }

                    this.logger.trace({ data }, 's3: [S3PackageManager _getData body] @{data.name}');
                    resolve(data);
                }
            );
        });
    }

    public deletePackage(fileName: string, callback: Callback): void {
        this.s3.deleteObject(
            {
                Bucket: this.config.bucket,
                Key: `${this.packagePath}/${fileName}`,
            },
            (err) => {
                if (err) {
                    callback(err);
                } else {
                    callback(null);
                }
            }
        );
    }

    public removePackage(callback: CallbackAction): void {
        deleteKeyPrefix(
            this.s3,
            {
                Bucket: this.config.bucket,
                Prefix: addTrailingSlash(this.packagePath),
            },
            function (err) {
                if (err && is404Error(err as VerdaccioError)) {
                    callback(null);
                } else {
                    callback(err);
                }
            }
        );
    }

    public createPackage(name: string, value: Package, callback: CallbackAction): void {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager createPackage init] name @{name}/@{packageName}');
        this.logger.trace({ value }, 's3: [S3PackageManager createPackage init] name @value');
        this.s3.headObject(
            {
                Bucket: this.config.bucket,
                Key: `${this.packagePath}/${pkgFileName}`,
            },
            (err, data) => {
                if (err) {
                    const s3Err = convertS3Error(err);
                    // only allow saving if this file doesn't exist already
                    if (is404Error(s3Err)) {
                        this.logger.debug({ s3Err }, 's3: [S3PackageManager createPackage] 404 package not found]');
                        this.savePackage(name, value, callback);
                        this.logger.trace({ data }, 's3: [S3PackageManager createPackage] package saved data from s3: @{data}');
                    } else {
                        this.logger.error({ s3Err: s3Err.message }, 's3: [S3PackageManager createPackage error] @s3Err');
                        callback(s3Err);
                    }
                } else {
                    this.logger.debug('s3: [S3PackageManager createPackage ] package exist already');
                    callback(create409Error());
                }
            }
        );
    }

    public savePackage(name: string, value: Package, callback: CallbackAction): void {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager savePackage init] name @{name}/@{packageName}');
        this.logger.trace({ value }, 's3: [S3PackageManager savePackage ] init value @{value}');
        this.s3.putObject(
            {
                // TODO: not sure whether save the object with spaces will increase storage size
                Body: JSON.stringify(value, null, '  '),
                Bucket: this.config.bucket,
                Key: `${this.packagePath}/${pkgFileName}`,
            },
            callback
        );
    }

    public readPackage(name: string, callback: ReadPackageCallback): void {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager readPackage init] name @{name}/@{packageName}');
        (async (): Promise<void> => {
            try {
                const data: Package = (await this._getData()) as Package;
                this.logger.trace({ data, packageName: this.packageName }, 's3: [S3PackageManager readPackage] packageName: @{packageName} / data @{data}');
                callback(null, data);
            } catch (err: any) {
                this.logger.error({ err: err.message }, 's3: [S3PackageManager readPackage] @{err}');
                callback(err);
            }
        })();
    }

    public writeTarball(name: string): UploadTarball {
        const uploadStream = new UploadTarball({});
        const tempFilePath = path.join(os.tmpdir(), `${this.safePackageName(this.packageName)}-temp-tarball.tar.gz`);
        const writeStream = fs.createWriteStream(tempFilePath);

        uploadStream.pipe(writeStream);

        writeStream.on('finish', async () => {
            try {
                await this.extractAndUploadJSONFiles(tempFilePath);
                await this.uploadTarballToS3(tempFilePath, name);
                uploadStream.emit('success');
                this.logger.debug({ tempFilePath }, `s3: [S3PackageManager writeTarball] Tarball stream finished writing and was successfully processed: ${tempFilePath}`);
            } catch (error: unknown) {
                if (error instanceof Error) {
                    this.logger.error({ tempFilePath, error: error.message }, `s3: [S3PackageManager writeTarball] Error processing tarball at ${tempFilePath}: ${error.message}`);
                    uploadStream.emit('error', error);
                } else {
                    this.logger.error({ tempFilePath }, `s3: [S3PackageManager writeTarball] An unexpected error occurred processing tarball at ${tempFilePath}`);
                    uploadStream.emit('error', new Error('Unknown error occurred'));
                }
            } finally {
                fs.unlink(tempFilePath, (err) => {
                    if (err) {
                        this.logger.error({ tempFilePath, error: err.message }, `s3: [S3PackageManager writeTarball] Error deleting temporary file ${tempFilePath}: ${err.message}`);
                    } else {
                        this.logger.debug({ tempFilePath }, `s3: [S3PackageManager writeTarball] Temporary file deleted successfully: ${tempFilePath}`);
                    }
                });
            }
        });

        writeStream.on('error', (error: Error) => {
            this.logger.error({ tempFilePath, error: error.message }, `s3: [S3PackageManager writeTarball] Error writing to temporary file ${tempFilePath}: ${error.message}`);
            uploadStream.emit('error', error);
        });

        return uploadStream;
    }

    public async extractAndUploadJSONFiles(tempFilePath: string) {
        this.logger.debug({ tempFilePath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Starting extraction of JSON files from tarball at: @{tempFilePath}');
        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'extract-'));
        this.logger.debug({ tempDir }, 's3: [S3PackageManager extractAndUploadJSONFiles] Temporary directory created for extraction at: @{tempDir}');

        try {
            await tar.extract({
                file: tempFilePath,
                cwd: tempDir,
                gzip: true,
            });
            this.logger.debug({ tempFilePath, tempDir }, 's3: [S3PackageManager extractAndUploadJSONFiles] Tarball extracted successfully from @{tempFilePath} to @{tempDir}');

            const composerPath = path.join(tempDir, 'package', composerFileName);
            const extensionPath = path.join(tempDir, 'package', flbFileName);

            const composerJsonExists = fs.existsSync(composerPath);
            const extensionJsonExists = fs.existsSync(extensionPath);
            this.logger.debug({ composerPath }, `s3: [S3PackageManager extractAndUploadJSONFiles] Composer JSON file exists: ${composerJsonExists} at @{composerPath}`);
            this.logger.debug({ extensionPath }, `s3: [S3PackageManager extractAndUploadJSONFiles] Extension JSON file exists: ${extensionJsonExists} at @{extensionPath}`);

            const composerJsonContent = composerJsonExists ? await fs.promises.readFile(composerPath, 'utf8') : null;
            const extensionJsonContent = extensionJsonExists ? await fs.promises.readFile(extensionPath, 'utf8') : null;

            if (composerJsonContent) {
                this.logger.debug({ composerPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Uploading composer.json to S3 from @{composerPath}');
                await this.uploadExtensionJson(this.config.bucket, this.packagePath, composerFileName, composerJsonContent);
                this.logger.debug({ bucket: this.config.bucket, path: `${this.packagePath}/${composerFileName}` }, 'Composer.json uploaded successfully to @{bucket}/@{path}');
            } else {
                this.logger.debug({ composerPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Composer.json not found or empty at @{composerPath}');
            }

            if (extensionJsonContent) {
                this.logger.debug({ extensionPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Uploading extension.json to S3 from @{extensionPath}');
                await this.uploadExtensionJson(this.config.bucket, this.packagePath, flbFileName, extensionJsonContent);
                this.logger.debug({ bucket: this.config.bucket, path: `${this.packagePath}/${flbFileName}` }, 'Extension.json uploaded successfully to @{bucket}/@{path}');
            } else {
                this.logger.debug({ extensionPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Extension.json not found or empty at @{extensionPath}');
            }

            return { composerJsonContent, extensionJsonContent };
        } finally {
            // Clean up the extraction directory
            await fs.promises.rm(tempDir, { recursive: true });
            this.logger.debug({ tempDir }, 's3: [S3PackageManager extractAndUploadJSONFiles] Cleaned up extraction directory at @{tempDir}');
        }
    }

    public async uploadTarballToS3(tempFilePath: string, name: string) {
        const params = {
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${name}`,
            Body: fs.createReadStream(tempFilePath),
            ACL: this.tarballACL,
        };

        await this.s3.upload(params).promise();
        this.logger.debug({ name }, 's3: [S3PackageManager uploadTarballToS3] Tarball uploaded successfully to S3: @{name}');
    }

    public readTarball(name: string): ReadTarball {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager readTarball init] name @{name}/@{packageName}');
        const readTarballStream = new ReadTarball({});

        const request = this.s3.getObject({
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${name}`,
        });

        let headersSent = false;

        const readStream = request
            .on('httpHeaders', (statusCode, headers) => {
                // don't process status code errors here, we'll do that in readStream.on('error'
                // otherwise they'll be processed twice

                // verdaccio force garbage collects a stream on 404, so we can't emit more
                // than one error or it'll fail
                // https://github.com/verdaccio/verdaccio/blob/c1bc261/src/lib/storage.js#L178
                this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager readTarball httpHeaders] name @{name}/@{packageName}');
                this.logger.trace({ headers }, 's3: [S3PackageManager readTarball httpHeaders event] headers @headers');
                this.logger.trace({ statusCode }, 's3: [S3PackageManager readTarball httpHeaders event] statusCode @{statusCode}');
                if (statusCode !== HTTP_STATUS.NOT_FOUND) {
                    if (headers[HEADERS.CONTENT_LENGTH]) {
                        const contentLength = parseInt(headers[HEADERS.CONTENT_LENGTH], 10);

                        // not sure this is necessary
                        if (headersSent) {
                            return;
                        }

                        headersSent = true;

                        this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] emit content-length');
                        readTarballStream.emit(HEADERS.CONTENT_LENGTH, contentLength);
                        // we know there's content, so open the stream
                        readTarballStream.emit('open');
                        this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] emit open');
                    }
                } else {
                    this.logger.trace('s3: [S3PackageManager readTarball httpHeaders event] not found, avoid emit open file');
                }
            })
            .createReadStream();

        readStream.on('error', async (err) => {
            const error: HttpError = convertS3Error(err as AWSError);

            this.logger.debug({ errorCode: error.code }, 'Package not found in S3, ERROR CODE: @{errorCode}');

            if (error.code === 404) {
                const npmUrl = `https://registry.npmjs.org/${this.packageName}/-/${name}`;
                this.logger.debug({ npmUrl }, 'Package not found in S3, attempting to fetch from npm: @{npmUrl}');

                try {
                    const response = await axios({
                        method: 'get',
                        url: npmUrl,
                        responseType: 'stream',
                    });

                    // Handle headers directly
                    const contentLength = response.headers['content-length'];
                    if (contentLength) {
                        readTarballStream.emit(HEADERS.CONTENT_LENGTH, parseInt(contentLength, 10));
                    }
                    readTarballStream.emit('open');

                    // Pipe the npm data to the readTarballStream
                    response.data.pipe(readTarballStream);
                } catch (npmError) {
                    readTarballStream.emit('error', error);
                    this.logger.error({ error: error.message }, 's3: [S3PackageManager readTarball readTarballStream event] error @{error}');
                }
            } else {
                readTarballStream.emit('error', error);
                this.logger.error({ error: error.message }, 's3: [S3PackageManager readTarball readTarballStream event] error @{error}');
            }
        });

        this.logger.trace('s3: [S3PackageManager readTarball readTarballStream event] pipe');
        readStream.pipe(readTarballStream);

        readTarballStream.abort = (): void => {
            this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] request abort');
            request.abort();
            this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] request destroy');
            readStream.destroy();
        };

        return readTarballStream;
    }

    public async uploadExtensionJson(bucket, packagePath, fileName, fileContent) {
        this.logger.debug({ bucket, packagePath, fileName }, 's3: [S3PackageManager uploadExtensionJson] Preparing to upload file: @{fileName} to bucket: @{bucket}');

        try {
            await this.s3
                .putObject({
                    Bucket: bucket,
                    Key: `${packagePath}/${fileName}`,
                    Body: fileContent,
                })
                .promise();

            this.logger.debug({ bucket, packagePath, fileName }, 's3: [S3PackageManager uploadExtensionJson] File uploaded successfully to @{packagePath}/@{fileName}');
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [S3PackageManager uploadExtensionJson] error @{error}');
            }
            throw error;
        }
    }
}
