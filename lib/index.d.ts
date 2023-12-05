import { Logger, Config, Callback, IPluginStorage, PluginOptions, Token, TokenFilter } from '@verdaccio/legacy-types';
import { S3Config } from './config';
import S3PackageManager from './s3PackageManager';
export { S3Config };
export default class S3Database implements IPluginStorage<S3Config> {
    logger: Logger;
    config: S3Config;
    private s3;
    private _localData;
    constructor(config: Config, options: PluginOptions<S3Config>);
    getSecret(): Promise<string>;
    setSecret(secret: string): Promise<void>;
    add(name: string, callback: Callback): void;
    search(onPackage: Function, onEnd: Function): Promise<void>;
    private _fetchPackageInfo;
    remove(name: string, callback: Callback): void;
    get(callback: Callback): void;
    getAsync(): Promise<string[]>;
    private _sync;
    getPackageStorage(packageName: string): S3PackageManager;
    private _getData;
    saveToken(token: Token): Promise<void>;
    deleteToken(user: string, tokenKey: string): Promise<void>;
    readTokens(filter: TokenFilter): Promise<Token[]>;
    getComposerJson(packageName: string): Promise<string | null>;
    getExtensionJson(packageName: string): Promise<string | null>;
    getAllExtensionJson(): Promise<any[]>;
    getAllComposerJson(): Promise<{
        packages: {
            [packageName: string]: any;
        };
    }>;
    private _getPackagePath;
    private _getPackageTarballUrl;
}
//# sourceMappingURL=index.d.ts.map