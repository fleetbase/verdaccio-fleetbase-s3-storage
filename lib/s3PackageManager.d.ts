import { UploadTarball, ReadTarball } from '@verdaccio/streams';
import { Callback, Logger, Package, ILocalPackageManager, CallbackAction, ReadPackageCallback } from '@verdaccio/legacy-types';
import { S3Config } from './config';
export default class S3PackageManager implements ILocalPackageManager {
    config: S3Config;
    logger: Logger;
    private readonly packageName;
    private readonly s3;
    private readonly packagePath;
    private readonly tarballACL;
    constructor(config: S3Config, packageName: string, logger: Logger);
    safePackageName(packageName: string): string;
    getPackagePath(): string;
    updatePackage(name: string, updateHandler: Callback, onWrite: Callback, transformPackage: Function, onEnd: Callback): void;
    private _getData;
    deletePackage(fileName: string, callback: Callback): void;
    removePackage(callback: CallbackAction): void;
    createPackage(name: string, value: Package, callback: CallbackAction): void;
    savePackage(name: string, value: Package, callback: CallbackAction): void;
    readPackage(name: string, callback: ReadPackageCallback): void;
    writeTarball(name: string): UploadTarball;
    extractAndUploadJSONFiles(tempFilePath: string): Promise<{
        composerJsonContent: string | null;
        extensionJsonContent: string | null;
    }>;
    uploadTarballToS3(tempFilePath: string, name: string): Promise<void>;
    readTarball(name: string): ReadTarball;
    uploadExtensionJson(bucket: any, packagePath: any, fileName: any, fileContent: any): Promise<void>;
}
//# sourceMappingURL=s3PackageManager.d.ts.map