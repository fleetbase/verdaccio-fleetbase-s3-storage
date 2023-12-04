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
    updatePackage(name: string, updateHandler: Callback, onWrite: Callback, transformPackage: Function, onEnd: Callback): void;
    private _getData;
    deletePackage(fileName: string, callback: Callback): void;
    removePackage(callback: CallbackAction): void;
    createPackage(name: string, value: Package, callback: CallbackAction): void;
    savePackage(name: string, value: Package, callback: CallbackAction): void;
    readPackage(name: string, callback: ReadPackageCallback): void;
    writeTarball(name: string): UploadTarball;
    readTarball(name: string): ReadTarball;
}
//# sourceMappingURL=s3PackageManager.d.ts.map