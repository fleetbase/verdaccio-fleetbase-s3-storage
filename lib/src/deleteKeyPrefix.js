"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteKeyPrefix = void 0;
const s3Errors_1 = require("./s3Errors");
function deleteKeyPrefix(s3, options, callback) {
    s3.listObjectsV2(options, (err, data) => {
        if (err) {
            callback((0, s3Errors_1.convertS3Error)(err));
        }
        else if (data.KeyCount) {
            const objectsToDelete = data.Contents
                ? data.Contents.map(s3Object => ({ Key: s3Object.Key }))
                : [];
            s3.deleteObjects({
                Bucket: options.Bucket,
                Delete: { Objects: objectsToDelete },
            }, err => {
                if (err) {
                    callback((0, s3Errors_1.convertS3Error)(err));
                }
                else {
                    callback(null);
                }
            });
        }
        else {
            callback((0, s3Errors_1.create404Error)());
        }
    });
}
exports.deleteKeyPrefix = deleteKeyPrefix;
