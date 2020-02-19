/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

'use strict';

const assert = require('assert');
const index = require('../src/index.js');

require('dotenv').config();

describe('Index Tests', () => {
  it('index with url', async () => {
    const url = 'https://theblog.adobe.com/look-dont-touch-the-rise-of-drone-footage/';
    const result = await index.main({
      url,
      force: true,
      AZURE_BLOB_SAS: process.env.AZURE_BLOB_SAS,
      AZURE_BLOB_URI: process.env.AZURE_BLOB_URI,
      AZURE_ONEDRIVE_CLIENT_ID: process.env.AZURE_ONEDRIVE_CLIENT_ID,
      AZURE_ONEDRIVE_CLIENT_SECRET: process.env.AZURE_ONEDRIVE_CLIENT_SECRET,
      AZURE_ONEDRIVE_REFRESH_TOKEN: process.env.AZURE_ONEDRIVE_REFRESH_TOKEN,
      AZURE_ONEDRIVE_CONTENT_LINK: process.env.AZURE_ONEDRIVE_CONTENT_LINK,
      AZURE_ONEDRIVE_ADMIN_LINK: process.env.AZURE_ONEDRIVE_ADMIN_LINK,
    });
    assert.deepEqual(result, { body: `Successfully imported ${url}` });
  });
});
