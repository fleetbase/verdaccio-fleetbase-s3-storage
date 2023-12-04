"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (path) => {
    return path != null ? (path.endsWith('/') ? path : `${path}/`) : '';
};
