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

'use strict';

const index = require('../src/index');

require('dotenv').config();

async function main() {
  const url = process.argv[2];

  const result = await index.main({
    url,
    force: true,
    checkIfRelatedExists: false,
    AZURE_BLOB_SAS: process.env.AZURE_BLOB_SAS,
    AZURE_BLOB_URI: process.env.AZURE_BLOB_URI,
    AZURE_ONEDRIVE_CLIENT_ID: process.env.AZURE_ONEDRIVE_CLIENT_ID,
    AZURE_ONEDRIVE_CLIENT_SECRET: process.env.AZURE_ONEDRIVE_CLIENT_SECRET,
    AZURE_ONEDRIVE_REFRESH_TOKEN: process.env.AZURE_ONEDRIVE_REFRESH_TOKEN,
    AZURE_ONEDRIVE_CONTENT_LINK: process.env.AZURE_ONEDRIVE_CONTENT_LINK,
    AZURE_ONEDRIVE_ADMIN_LINK: process.env.AZURE_ONEDRIVE_ADMIN_LINK,
    FASTLY_TOKEN: process.env.FASTLY_TOKEN,
    FASTLY_SERVICE_ID: process.env.FASTLY_SERVICE_ID,
    localStorage: './output',
    cache: './.cache',
    SP_URLS_XLSX: process.env.SP_URLS_XLSX,
    SP_URLS_XLSX_WORKSHEET: process.env.SP_URLS_XLSX_WORKSHEET,
    SP_URLS_XLSX_TABLE: process.env.SP_URLS_XLSX_TABLE,
    SP_MAPPINGS_XLSX: process.env.SP_MAPPINGS_XLSX,
    SP_MAPPINGS_XLSX_CATEGORIES_WORKSHEET: process.env.SP_MAPPINGS_XLSX_CATEGORIES_WORKSHEET,
    SP_MAPPINGS_XLSX_CATEGORIES_TABLE: process.env.SP_MAPPINGS_XLSX_CATEGORIES_TABLE,
    SP_MAPPINGS_XLSX_PRODUCTS_WORKSHEET: process.env.SP_MAPPINGS_XLSX_PRODUCTS_WORKSHEET,
    SP_MAPPINGS_XLSX_PRODUCTS_TABLE: process.env.SP_MAPPINGS_XLSX_PRODUCTS_TABLE,
  });
  console.log('Result: ', result);
}

main();
