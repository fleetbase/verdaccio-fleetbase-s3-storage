import { S3Config } from './config';

function toCamelCase(str: string): string {
    return str
        .split(/[-_ ]+/)
        .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join('');
}

export default (key: string, config: S3Config): string => {
    const envValue = process.env[key];
    const configKey = toCamelCase(key.toLowerCase().replace('aws_', ''));
    return envValue || config[configKey];
};
