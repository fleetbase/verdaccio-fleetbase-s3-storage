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
    safePackageName(packageName) {
        return packageName.replace(/[@\/]/g, '-').replace(/^-/, '');
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
        const uploadStream = new streams_1.UploadTarball({});
        const tempFilePath = path_1.default.join(os_1.default.tmpdir(), `${this.safePackageName(this.packageName)}-temp-tarball.tar.gz`);
        const writeStream = fs_1.default.createWriteStream(tempFilePath);
        uploadStream.pipe(writeStream);
        writeStream.on('finish', async () => {
            try {
                await this.extractAndUploadJSONFiles(tempFilePath);
                await this.uploadTarballToS3(tempFilePath, name);
                uploadStream.emit('success');
                this.logger.debug({ tempFilePath }, `s3: [S3PackageManager writeTarball] Tarball stream finished writing and was successfully processed: ${tempFilePath}`);
            }
            catch (error) {
                if (error instanceof Error) {
                    this.logger.error({ tempFilePath, error: error.message }, `s3: [S3PackageManager writeTarball] Error processing tarball at ${tempFilePath}: ${error.message}`);
                    uploadStream.emit('error', error);
                }
                else {
                    this.logger.error({ tempFilePath }, `s3: [S3PackageManager writeTarball] An unexpected error occurred processing tarball at ${tempFilePath}`);
                    uploadStream.emit('error', new Error('Unknown error occurred'));
                }
            }
            finally {
                fs_1.default.unlink(tempFilePath, (err) => {
                    if (err) {
                        this.logger.error({ tempFilePath, error: err.message }, `s3: [S3PackageManager writeTarball] Error deleting temporary file ${tempFilePath}: ${err.message}`);
                    }
                    else {
                        this.logger.debug({ tempFilePath }, `s3: [S3PackageManager writeTarball] Temporary file deleted successfully: ${tempFilePath}`);
                    }
                });
            }
        });
        writeStream.on('error', (error) => {
            this.logger.error({ tempFilePath, error: error.message }, `s3: [S3PackageManager writeTarball] Error writing to temporary file ${tempFilePath}: ${error.message}`);
            uploadStream.emit('error', error);
        });
        return uploadStream;
    }
    async extractAndUploadJSONFiles(tempFilePath) {
        this.logger.debug({ tempFilePath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Starting extraction of JSON files from tarball at: @{tempFilePath}');
        const tempDir = await fs_1.default.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'extract-'));
        this.logger.debug({ tempDir }, 's3: [S3PackageManager extractAndUploadJSONFiles] Temporary directory created for extraction at: @{tempDir}');
        try {
            await tar_1.default.extract({
                file: tempFilePath,
                cwd: tempDir,
                gzip: true,
            });
            this.logger.debug({ tempFilePath, tempDir }, 's3: [S3PackageManager extractAndUploadJSONFiles] Tarball extracted successfully from @{tempFilePath} to @{tempDir}');
            const composerPath = path_1.default.join(tempDir, 'package', composerFileName);
            const extensionPath = path_1.default.join(tempDir, 'package', flbFileName);
            const composerJsonExists = fs_1.default.existsSync(composerPath);
            const extensionJsonExists = fs_1.default.existsSync(extensionPath);
            this.logger.debug({ composerPath }, `s3: [S3PackageManager extractAndUploadJSONFiles] Composer JSON file exists: ${composerJsonExists} at @{composerPath}`);
            this.logger.debug({ extensionPath }, `s3: [S3PackageManager extractAndUploadJSONFiles] Extension JSON file exists: ${extensionJsonExists} at @{extensionPath}`);
            const composerJsonContent = composerJsonExists ? await fs_1.default.promises.readFile(composerPath, 'utf8') : null;
            const extensionJsonContent = extensionJsonExists ? await fs_1.default.promises.readFile(extensionPath, 'utf8') : null;
            if (composerJsonContent) {
                this.logger.debug({ composerPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Uploading composer.json to S3 from @{composerPath}');
                await this.uploadExtensionJson(this.config.bucket, this.packagePath, composerFileName, composerJsonContent);
                this.logger.debug({ bucket: this.config.bucket, path: `${this.packagePath}/${composerFileName}` }, 'Composer.json uploaded successfully to @{bucket}/@{path}');
            }
            else {
                this.logger.debug({ composerPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Composer.json not found or empty at @{composerPath}');
            }
            if (extensionJsonContent) {
                this.logger.debug({ extensionPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Uploading extension.json to S3 from @{extensionPath}');
                await this.uploadExtensionJson(this.config.bucket, this.packagePath, flbFileName, extensionJsonContent);
                this.logger.debug({ bucket: this.config.bucket, path: `${this.packagePath}/${flbFileName}` }, 'Extension.json uploaded successfully to @{bucket}/@{path}');
            }
            else {
                this.logger.debug({ extensionPath }, 's3: [S3PackageManager extractAndUploadJSONFiles] Extension.json not found or empty at @{extensionPath}');
            }
            return { composerJsonContent, extensionJsonContent };
        }
        finally {
            // Clean up the extraction directory
            await fs_1.default.promises.rm(tempDir, { recursive: true });
            this.logger.debug({ tempDir }, 's3: [S3PackageManager extractAndUploadJSONFiles] Cleaned up extraction directory at @{tempDir}');
        }
    }
    async uploadTarballToS3(tempFilePath, name) {
        const params = {
            Bucket: this.config.bucket,
            Key: `${this.packagePath}/${name}`,
            Body: fs_1.default.createReadStream(tempFilePath),
            ACL: this.tarballACL,
        };
        await this.s3.upload(params).promise();
        this.logger.debug({ name }, 's3: [S3PackageManager uploadTarballToS3] Tarball uploaded successfully to S3: @{name}');
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
            this.logger.debug({ bucket, packagePath, fileName }, 's3: [S3PackageManager uploadExtensionJson] File uploaded successfully to @{packagePath}/@{fileName}');
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
