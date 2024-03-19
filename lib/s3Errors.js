"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertS3Error = exports.create503Error = exports.is503Error = exports.create409Error = exports.is409Error = exports.create404Error = exports.is404Error = void 0;
const commons_api_1 = require("@verdaccio/commons-api");
function is404Error(err) {
    return err.code === commons_api_1.HTTP_STATUS.NOT_FOUND;
}
exports.is404Error = is404Error;
function create404Error() {
    return (0, commons_api_1.getNotFound)('no such package available');
}
exports.create404Error = create404Error;
function is409Error(err) {
    return err.code === commons_api_1.HTTP_STATUS.CONFLICT;
}
exports.is409Error = is409Error;
function create409Error() {
    return (0, commons_api_1.getConflict)('file already exists');
}
exports.create409Error = create409Error;
function is503Error(err) {
    return err.code === commons_api_1.HTTP_STATUS.SERVICE_UNAVAILABLE;
}
exports.is503Error = is503Error;
function create503Error() {
    return (0, commons_api_1.getCode)(commons_api_1.HTTP_STATUS.SERVICE_UNAVAILABLE, 'resource temporarily unavailable');
}
exports.create503Error = create503Error;
function convertS3Error(err) {
    switch (err.code) {
        case 'NoSuchKey':
        case 'NotFound':
            return (0, commons_api_1.getNotFound)();
        case 'StreamContentLengthMismatch':
            return (0, commons_api_1.getInternalError)(commons_api_1.API_ERROR.CONTENT_MISMATCH);
        case 'RequestAbortedError':
            return (0, commons_api_1.getInternalError)('request aborted');
        default:
            // @ts-ignore
            const statusCode = err.statusCode || commons_api_1.HTTP_STATUS.INTERNAL_ERROR;
            const message = err.message || 'unknown error';
            return (0, commons_api_1.getCode)(statusCode, message);
    }
}
exports.convertS3Error = convertS3Error;
