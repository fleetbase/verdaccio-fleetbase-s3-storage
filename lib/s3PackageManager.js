"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = require("aws-sdk");
const streams_1 = require("@verdaccio/streams");
const commons_api_1 = require("@verdaccio/commons-api");
const os_1 = __importDefault(require("os"));
const tar_1 = __importDefault(require("tar"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const s3Errors_1 = require("./s3Errors");
const deleteKeyPrefix_1 = require("./deleteKeyPrefix");
const addTrailingSlash_1 = __importDefault(require("./addTrailingSlash"));
const pkgFileName = 'package.json';
const composerFileName = 'composer.json';
const flbFileName = 'extension.json';
class S3PackageManager {
    config;
    logger;
    packageName;
    s3;
    packagePath;
    tarballACL;
    constructor(config, packageName, logger) {
        this.config = config;
        this.packageName = packageName;
        this.logger = logger;
        const { endpoint, region, s3ForcePathStyle, accessKeyId, secretAccessKey, sessionToken, tarballACL } = config;
        this.tarballACL = tarballACL || 'private';
        this.s3 = new aws_sdk_1.S3({
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
            const packageCustomFolder = (0, addTrailingSlash_1.default)(storage);
            this.packagePath = `${this.config.keyPrefix}${packageCustomFolder}${this.packageName}`;
        }
        else {
            this.packagePath = `${this.config.keyPrefix}${this.packageName}`;
        }
    }
    getPackagePath() {
        return this.packagePath ? this.packagePath : '';
    }
    updatePackage(name, updateHandler, onWrite, transformPackage, onEnd) {
        this.logger.debug({ name }, 's3: [S3PackageManager updatePackage init] @{name}');
        (async () => {
            try {
                const json = await this._getData();
                updateHandler(json, (err) => {
                    if (err) {
                        this.logger.error({ err }, 's3: [S3PackageManager updatePackage updateHandler onEnd] @{err}');
                        onEnd(err);
                    }
                    else {
                        const transformedPackage = transformPackage(json);
                        this.logger.debug({ transformedPackage }, 's3: [S3PackageManager updatePackage updateHandler onWrite] @{transformedPackage}');
                        onWrite(name, transformedPackage, onEnd);
                    }
                });
            }
            catch (err) {
                this.logger.error({ err }, 's3: [S3PackageManager updatePackage updateHandler onEnd catch] @{err}');
                return onEnd(err);
            }
        })();
    }
    async _getData() {
        this.logger.debug('s3: [S3PackageManager _getData init]');
        return await new Promise((resolve, reject) => {
            this.s3.getObject({
                Bucket: this.config.bucket,
                Key: `${this.packagePath}/${pkgFileName}`,
            }, (err, response) => {
                if (err) {
                    this.logger.error({ err: err.message }, 's3: [S3PackageManager _getData] aws @{err}');
                    const error = (0, s3Errors_1.convertS3Error)(err);
                    this.logger.error({ error: err.message }, 's3: [S3PackageManager _getData] @{error}');
                    reject(error);
                    return;
                }
                const body = response.Body ? response.Body.toString() : '';
                let data;
                try {
                    data = JSON.parse(body);
                }
                catch (e) {
                    this.logger.error({ body }, 's3: [S3PackageManager _getData] error parsing: @{body}');
                    reject(e);
                    return;
                }
                this.logger.trace({ data }, 's3: [S3PackageManager _getData body] @{data.name}');
                resolve(data);
            });
        });
    }
    deletePackage(fileName, callback) {
        this.s3.deleteObject({
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${fileName}`,
        }, (err) => {
            if (err) {
                callback(err);
            }
            else {
                callback(null);
            }
        });
    }
    removePackage(callback) {
        (0, deleteKeyPrefix_1.deleteKeyPrefix)(this.s3, {
            Bucket: this.config.bucket,
            Prefix: (0, addTrailingSlash_1.default)(this.packagePath),
        }, function (err) {
            if (err && (0, s3Errors_1.is404Error)(err)) {
                callback(null);
            }
            else {
                callback(err);
            }
        });
    }
    createPackage(name, value, callback) {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager createPackage init] name @{name}/@{packageName}');
        this.logger.trace({ value }, 's3: [S3PackageManager createPackage init] name @value');
        this.s3.headObject({
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${pkgFileName}`,
        }, (err, data) => {
            if (err) {
                const s3Err = (0, s3Errors_1.convertS3Error)(err);
                // only allow saving if this file doesn't exist already
                if ((0, s3Errors_1.is404Error)(s3Err)) {
                    this.logger.debug({ s3Err }, 's3: [S3PackageManager createPackage] 404 package not found]');
                    this.savePackage(name, value, callback);
                    this.logger.trace({ data }, 's3: [S3PackageManager createPackage] package saved data from s3: @{data}');
                }
                else {
                    this.logger.error({ s3Err: s3Err.message }, 's3: [S3PackageManager createPackage error] @s3Err');
                    callback(s3Err);
                }
            }
            else {
                this.logger.debug('s3: [S3PackageManager createPackage ] package exist already');
                callback((0, s3Errors_1.create409Error)());
            }
        });
    }
    savePackage(name, value, callback) {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager savePackage init] name @{name}/@{packageName}');
        this.logger.trace({ value }, 's3: [S3PackageManager savePackage ] init value @{value}');
        this.s3.putObject({
            // TODO: not sure whether save the object with spaces will increase storage size
            Body: JSON.stringify(value, null, '  '),
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${pkgFileName}`,
        }, callback);
    }
    readPackage(name, callback) {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager readPackage init] name @{name}/@{packageName}');
        (async () => {
            try {
                const data = (await this._getData());
                this.logger.trace({ data, packageName: this.packageName }, 's3: [S3PackageManager readPackage] packageName: @{packageName} / data @{data}');
                callback(null, data);
            }
            catch (err) {
                this.logger.error({ err: err.message }, 's3: [S3PackageManager readPackage] @{err}');
                callback(err);
            }
        })();
    }
    writeTarball(name) {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager writeTarball init] name @{name}/@{packageName}');
        const uploadStream = new streams_1.UploadTarball({});
        let streamEnded = 0;
        uploadStream.on('end', () => {
            this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager writeTarball event: end] name @{name}/@{packageName}');
            streamEnded = 1;
        });
        // Handle uploading of fleetbase extension files
        this.uploadFleetbaseExtensionFromTarballStream(uploadStream);
        const baseS3Params = {
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${name}`,
        };
        // NOTE: I'm using listObjectVersions so I don't have to download the full object with getObject.
        // Preferably, I'd use getObjectMetadata or getDetails when it's available in the node sdk
        // TODO: convert to headObject
        this.s3.headObject({
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${name}`,
        }, (err) => {
            if (err) {
                const convertedErr = (0, s3Errors_1.convertS3Error)(err);
                this.logger.error({ error: convertedErr.message }, 's3: [S3PackageManager writeTarball headObject] @{error}');
                if ((0, s3Errors_1.is404Error)(convertedErr) === false) {
                    this.logger.error({
                        error: convertedErr.message,
                    }, 's3: [S3PackageManager writeTarball headObject] non a 404 emit error: @{error}');
                    uploadStream.emit('error', convertedErr);
                }
                else {
                    this.logger.debug('s3: [S3PackageManager writeTarball managedUpload] init stream');
                    const managedUpload = this.s3.upload(Object.assign({}, baseS3Params, { Body: uploadStream, ACL: this.tarballACL }));
                    // NOTE: there's a managedUpload.promise, but it doesn't seem to work
                    const promise = new Promise((resolve) => {
                        this.logger.debug('s3: [S3PackageManager writeTarball managedUpload] send');
                        managedUpload.send((err, data) => {
                            if (err) {
                                const error = (0, s3Errors_1.convertS3Error)(err);
                                this.logger.error({ error: error.message }, 's3: [S3PackageManager writeTarball managedUpload send] emit error @{error}');
                                uploadStream.emit('error', error);
                            }
                            else {
                                this.logger.trace({ data }, 's3: [S3PackageManager writeTarball managedUpload send] response @{data}');
                                resolve(undefined);
                            }
                        });
                        this.logger.debug({ name }, 's3: [S3PackageManager writeTarball uploadStream] emit open @{name}');
                        uploadStream.emit('open');
                    });
                    uploadStream.done = () => {
                        const onEnd = async () => {
                            try {
                                await promise;
                                this.logger.debug('s3: [S3PackageManager writeTarball uploadStream done] emit success');
                                uploadStream.emit('success');
                            }
                            catch (err) {
                                // already emitted in the promise above, necessary because of some issues
                                // with promises in jest
                                this.logger.error({ err }, 's3: [S3PackageManager writeTarball uploadStream done] error @{err}');
                            }
                        };
                        if (streamEnded) {
                            this.logger.trace({ name }, 's3: [S3PackageManager writeTarball uploadStream] streamEnded true @{name}');
                            onEnd();
                        }
                        else {
                            this.logger.trace({ name }, 's3: [S3PackageManager writeTarball uploadStream] streamEnded false emit end @{name}');
                            uploadStream.on('end', onEnd);
                        }
                    };
                    uploadStream.abort = () => {
                        this.logger.debug('s3: [S3PackageManager writeTarball uploadStream abort] init');
                        try {
                            this.logger.debug('s3: [S3PackageManager writeTarball managedUpload abort]');
                            managedUpload.abort();
                        }
                        catch (err) {
                            const error = (0, s3Errors_1.convertS3Error)(err);
                            uploadStream.emit('error', error);
                            this.logger.error({ error }, 's3: [S3PackageManager writeTarball uploadStream error] emit error @{error}');
                        }
                        finally {
                            this.logger.debug({ name, baseS3Params }, 's3: [S3PackageManager writeTarball uploadStream abort] s3.deleteObject @{name}/@{baseS3Params}');
                            this.s3.deleteObject(baseS3Params);
                        }
                    };
                }
            }
            else {
                this.logger.debug({ name }, 's3: [S3PackageManager writeTarball headObject] emit error @{name} 409');
                uploadStream.emit('error', (0, s3Errors_1.create409Error)());
            }
        });
        return uploadStream;
    }
    readTarball(name) {
        this.logger.debug({ name, packageName: this.packageName }, 's3: [S3PackageManager readTarball init] name @{name}/@{packageName}');
        const readTarballStream = new streams_1.ReadTarball({});
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
            if (statusCode !== commons_api_1.HTTP_STATUS.NOT_FOUND) {
                if (headers[commons_api_1.HEADERS.CONTENT_LENGTH]) {
                    const contentLength = parseInt(headers[commons_api_1.HEADERS.CONTENT_LENGTH], 10);
                    // not sure this is necessary
                    if (headersSent) {
                        return;
                    }
                    headersSent = true;
                    this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] emit content-length');
                    readTarballStream.emit(commons_api_1.HEADERS.CONTENT_LENGTH, contentLength);
                    // we know there's content, so open the stream
                    readTarballStream.emit('open');
                    this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] emit open');
                }
            }
            else {
                this.logger.trace('s3: [S3PackageManager readTarball httpHeaders event] not found, avoid emit open file');
            }
        })
            .createReadStream();
        readStream.on('error', (err) => {
            const error = (0, s3Errors_1.convertS3Error)(err);
            readTarballStream.emit('error', error);
            this.logger.error({ error: error.message }, 's3: [S3PackageManager readTarball readTarballStream event] error @{error}');
        });
        this.logger.trace('s3: [S3PackageManager readTarball readTarballStream event] pipe');
        readStream.pipe(readTarballStream);
        readTarballStream.abort = () => {
            this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] request abort');
            request.abort();
            this.logger.debug('s3: [S3PackageManager readTarball readTarballStream event] request destroy');
            readStream.destroy();
        };
        return readTarballStream;
    }
    uploadFleetbaseExtensionFromTarballStream(uploadStream) {
        const tempDir = os_1.default.tmpdir();
        const safePackageName = this.packageName.replace(/[@\/]/g, '-').replace(/^-/, '');
        const tempFilePath = path_1.default.join(tempDir, `${safePackageName}-temp-tarball.tar.gz`);
        this.logger.debug({ tempFilePath }, 's3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] Creating temporary file for tarball: @{tempFilePath}');
        const writeStream = fs_1.default.createWriteStream(tempFilePath);
        uploadStream.pipe(writeStream);
        writeStream.on('finish', async () => {
            this.logger.debug({ tempFilePath }, 's3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] Tarball stream finished writing to temporary file');
            try {
                const { composerJsonContent, extensionJsonContent } = await this.checkTarballForExtensionJson(tempFilePath);
                if (composerJsonContent) {
                    this.logger.debug('s3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] Uploading composer.json');
                    await this.uploadExtensionJson(this.config.bucket, this.packagePath, composerFileName, composerJsonContent);
                }
                else {
                    this.logger.debug('s3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] composer.json not found in tarball');
                }
                if (extensionJsonContent) {
                    this.logger.debug('s3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] Uploading extension.json');
                    await this.uploadExtensionJson(this.config.bucket, this.packagePath, flbFileName, extensionJsonContent);
                }
                else {
                    this.logger.debug('s3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] extension.json not found in tarball');
                }
            }
            catch (error) {
                if (error instanceof Error) {
                    this.logger.error({ error: error.message }, 's3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] error @{error}');
                }
            }
            finally {
                fs_1.default.unlink(tempFilePath, (error) => {
                    if (error instanceof Error) {
                        this.logger.error({ error: error.message }, 's3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] error @{error}');
                    }
                    else {
                        this.logger.debug({ tempFilePath }, 's3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] Temporary file deleted');
                    }
                });
            }
        });
        writeStream.on('error', (error) => {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [S3PackageManager uploadFleetbaseExtensionFromTarballStream] error @{error}');
            }
        });
    }
    async checkTarballForExtensionJson(tarballPath) {
        try {
            // Create a temporary directory to extract files
            const tempDir = await fs_1.default.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'extract-'));
            this.logger.debug({ tarballPath, tempDir }, 's3: [S3PackageManager checkTarballForExtensionJson] Extracting tarball to temporary directory: @{tempDir}');
            await tar_1.default.extract({
                file: tarballPath,
                cwd: tempDir,
                // Filter for only the files we're interested in
                filter: (path) => path.endsWith(composerFileName) || path.endsWith(flbFileName),
            });
            let composerJsonContent = null;
            let extensionJsonContent = null;
            // Define paths to search
            const rootComposerJsonPath = path_1.default.join(tempDir, composerFileName);
            const packageComposerJsonPath = path_1.default.join(tempDir, 'package', composerFileName);
            const rootExtensionJsonPath = path_1.default.join(tempDir, flbFileName);
            const packageExtensionJsonPath = path_1.default.join(tempDir, 'package', flbFileName);
            // Check if the files exist in either location and read them
            const composerJsonPath = fs_1.default.existsSync(rootComposerJsonPath) ? rootComposerJsonPath : packageComposerJsonPath;
            if (fs_1.default.existsSync(composerJsonPath)) {
                composerJsonContent = await fs_1.default.promises.readFile(composerJsonPath, 'utf8');
                this.logger.debug({ composerJsonPath }, 's3: [S3PackageManager checkTarballForExtensionJson] Found and read composer.json');
            }
            else {
                this.logger.debug({ composerJsonPath }, 's3: [S3PackageManager checkTarballForExtensionJson] composer.json not found');
            }
            const extensionJsonPath = fs_1.default.existsSync(rootExtensionJsonPath) ? rootExtensionJsonPath : packageExtensionJsonPath;
            if (fs_1.default.existsSync(extensionJsonPath)) {
                extensionJsonContent = await fs_1.default.promises.readFile(extensionJsonPath, 'utf8');
                this.logger.debug({ extensionJsonPath }, 's3: [S3PackageManager checkTarballForExtensionJson] Found and read extension.json');
            }
            else {
                this.logger.debug({ extensionJsonPath }, 's3: [S3PackageManager checkTarballForExtensionJson] extension.json not found');
            }
            // Clean up the temporary directory
            await fs_1.default.promises.rmdir(tempDir, { recursive: true });
            return { composerJsonContent, extensionJsonContent };
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [S3PackageManager checkTarballForExtensionJson] error @{error}');
            }
            throw error;
        }
    }
    async uploadExtensionJson(bucket, packagePath, fileName, fileContent) {
        this.logger.debug({ bucket, packagePath, fileName }, 's3: [S3PackageManager uploadExtensionJson] Preparing to upload file: @{fileName} to bucket: @{bucket}');
        try {
            await this.s3
                .putObject({
                Bucket: bucket,
                Key: `${packagePath}/${fileName}`,
                Body: fileContent,
            })
                .promise();
            this.logger.debug({ bucket, packagePath, fileName }, 's3: [S3PackageManager uploadExtensionJson] File uploaded successfully to @{packagePath}');
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error({ error: error.message }, 's3: [S3PackageManager uploadExtensionJson] error @{error}');
            }
            throw error;
        }
    }
}
exports.default = S3PackageManager;
