"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (configValue) => {
    const envValue = process.env[configValue];
    return envValue || configValue;
};
