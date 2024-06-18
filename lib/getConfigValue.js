"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function toCamelCase(str) {
    return str
        .split(/[-_ ]+/)
        .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join('');
}
exports.default = (key, config) => {
    const envValue = process.env[key];
    const configKey = toCamelCase(key.toLowerCase().replace('aws_', ''));
    return envValue || config[configKey];
};
