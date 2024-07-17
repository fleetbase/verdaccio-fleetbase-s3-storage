# Fleetbase Verdaccio S3 Storage Plugin

The Fleetbase Verdaccio S3 Storage Plugin enables the storage of registry files on AWS S3 or similar providers. It is designed to enhance the Verdaccio package registry by providing robust, scalable storage solutions. Additionally, this plugin supports manual uplinks to ensure reliability and accessibility, even when direct downloads from the S3-backed registry encounter issues.

This plugin is integral to the official Fleetbase registry ([https://registry.fleetbase.io](https://registry.fleetbase.io)), a customized Verdaccio instance that supports both npm and composer protocols. It includes specific modifications to serve the unique needs of the Fleetbase ecosystem, particularly for handling Fleetbase extensions.

## Features

- **S3 Storage**: Seamlessly integrates with AWS S3 to store Verdaccio registry files, ensuring scalable and reliable package management.
- **Fallback Uplink Management**: Provides manual uplinks for package retrieval to maintain uptime and access even if the primary S3 connection fails.

## Installation

To install the plugin, use the following npm command:

```bash
npm install @fleetbase/verdaccio-fleetbase-s3-storage
```

## Configuration

After installation, configure the plugin in Verdaccio's `config.yaml` file. Below is a sample configuration snippet:

```yaml
store:
  '@fleetbase/verdaccio-fleetbase-s3-storage':
    bucket: fleetbase-registry
    keyPrefix: flb
    region: ap-southeast-1
    endpoint: http://minio:9000
    accessKeyId: foobar
    secretAccessKey: 1234567e
    s3ForcePathStyle: true
```

Replace the placeholder values with your actual S3 bucket details and AWS credentials.

## Environment Variables Configuration

The Fleetbase Verdaccio S3 Storage Plugin can also be configured using environment variables, providing a flexible way to manage configuration without hard-coding sensitive information directly into the `config.yaml` file. Below are the environment variables supported by the plugin:

- **AWS_BUCKET**: Specifies the S3 bucket name where registry files are stored.
- **AWS_KEY_PREFIX**: Allows specifying a prefix to be added to all keys stored in the bucket, useful for namespacing within the bucket.
- **AWS_ENDPOINT**: Sets the endpoint URL for the S3 API, useful for using S3-compatible services like MinIO.
- **AWS_REGION**: Defines the AWS region where your S3 bucket is located.
- **AWS_ACCESS_KEY_ID**: Your AWS access key ID for authentication.
- **AWS_SECRET_ACCESS_KEY**: Your AWS secret access key for authentication.
- **AWS_SESSION_TOKEN**: The session token for AWS access, necessary if using temporary credentials provided by AWS Security Token Service (STS).

These environment variables can be set in your system's environment settings or included in a `.env` file, depending on your deployment setup. Make sure to keep your AWS access keys and session tokens secure and do not expose them in public code repositories.

Here is an example of how you might set these variables in a `.env` file:

\```plaintext
AWS_BUCKET=fleetbase-registry
AWS_KEY_PREFIX=flb
AWS_ENDPOINT=http://minio:9000
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=foobar
AWS_SECRET_ACCESS_KEY=1234567e
AWS_SESSION_TOKEN=your-session-token-here
\```

Ensure that the environment variables are loaded into your environment where Verdaccio runs so that they can be appropriately used by the plugin.

## Usage

Once configured, Verdaccio will automatically begin using the configured S3 bucket for storing and retrieving package data. Ensure that your AWS credentials and bucket permissions are set correctly to avoid any access issues.

## Contributing

Contributions to the Fleetbase Verdaccio S3 Storage Plugin are welcome! Please refer to the project's [CONTRIBUTING.md](#) for guidelines on how to make contributions.

## License

This project is licensed under the AGPL v3 License - see the [LICENSE](LICENSE) file for details.

## Support

For support, feature requests, or any queries, please visit the [issues section](https://github.com/fleetbase/verdaccio-fleetbase-s3-storage/issues) of our GitHub repository.

## Acknowledgments

- Thanks to the Verdaccio community for the extensive support and plugins ecosystem.
- Special thanks to the contributors who help maintain and improve this plugin.