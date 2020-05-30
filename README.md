# Helix Service

Helix TheBlog importer downloads the content associated to the provided url (blog post entry) and creates a markdown version stored in OneDrive.

- if url is not part of the urls list - OneDrive XLSX file (/importer/urls.xlsx)
- download url content
- parse the dom, remove undesired blocks, extracts author, post, products and topics
- transform to various snippets into markdown
- upload to OneDrive
- update the urls list

The importer cannot be called directly but is invoked by the [scanner](https://github.com/adobe/helix-theblog-scanner).

## Options

- `FASTLY_SERVICE_ID`: Service ID for "theblog"
- `FASTLY_TOKEN`: a Fastly API Token

If you don't provide `FASTLY_SERVICE_ID` and `FASTLY_TOKEN`, then no redirects will be created for imported blog posts.

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-theblog-importer.svg)](https://codecov.io/gh/adobe/helix-theblog-importer)
[![CircleCI](https://img.shields.io/circleci/project/github/adobe/helix-theblog-importer.svg)](https://circleci.com/gh/adobe/helix-theblog-importer)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-theblog-importer.svg)](https://github.com/adobe/helix-theblog-importer/blob/master/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-theblog-importer.svg)](https://github.com/adobe/helix-theblog-importer/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-theblog-importer.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-theblog-importer)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release) 

## Installation

## Setup

### Installation

Deploy the action:

```
npm run deploy
```

### Required env variables:

Connection to OneDrive:

- `AZURE_ONEDRIVE_CLIENT_ID`
- `AZURE_ONEDRIVE_CLIENT_SECRET`
- `AZURE_ONEDRIVE_REFRESH_TOKEN`

Blob storage credentials (store images):

- AZURE_BLOB_URI
- AZURE_BLOB_SAS

OneDrive shared folder that contains the `/importer/urls.xlsx` file:

- `AZURE_ONEDRIVE_ADMIN_LINK`

OneDrive shared folder: destination of the markdown file:

- `AZURE_ONEDRIVE_CONTENT_LINK`

Openwhish credentials to invoke the helix-theblog-importer action:

- `OPENWHISK_API_KEY`
- `OPENWHISK_API_HOST`

Coralogix credentials to log: 

- `CORALOGIX_API_KEY`
- `CORALOGIX_LOG_LEVEL`

Fastly credentials to store keys in dictionary (url shortcuts mapping):

- `FASTLY_SERVICE_ID`
- `FASTLY_TOKEN`

## Development

### Deploying Helix Service

Deploying Helix Service requires the `wsk` command line client, authenticated to a namespace of your choice. For Project Helix, we use the `helix` namespace.

All commits to master that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get commited as `/helix-theblog/helix-theblog-importer@ci<num>` and tagged with the CI build number.
