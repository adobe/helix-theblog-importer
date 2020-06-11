/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable no-console, no-underscore-dangle */

require('dotenv').config();

const path = require('path');
const CsvFile = require('./CsvFile');
const ExcelHandler = require('../handlers/ExcelHandler');
const { main: importer } = require('../index');
const { load: loadMappings } = require('../mappings');

const URLS_XLSX = '/importer/urls.xlsx';
const URLS_XLSX_WORKSHEET = 'urls';
const URLS_XLSX_TABLE = 'listOfURLS';

const IMPORT_BATCH_SIZE = 10;

async function doImport(params, url, dataset) {
  try {
    const result = await importer({
      url,
      ...params,
    });
    if (result.statusCode === 200) {
      console.debug(result.body);
      dataset.push(result.data);
      return true;
    }
    if (result.body.indexOf('301') !== -1) {
      // append to 301 list
      await params._301sFile.append([{ link: url }]);
    } else {
      console.error(`Error in action for ${url}: `, result.body);
      await params._5xxFile.append([{ link: url }]);
    }
    return false;
  } catch (error) {
    console.error(`Error processing import for ${url}: ${error.message}`);
    if (error.message.indexOf('301') !== -1) {
      // append to 301 list
      await params._301sFile.append([{ link: url }]);
    } else {
      await params._5xxFile.append([{ link: url }]);
    }
    return false;
  }
}

async function doScan(params, scanned, excelHandler) {
  let countSuccess = 0;
  let countError = 0;
  let countTotal = 0;
  const urlsToImport = [];

  await params.urlsFile.readRows((row) => {
    countTotal += 1;
    const url = row.link;
    // exclude already scanned
    if (params.force || (scanned.indexOf(url) === -1 && urlsToImport.indexOf(url) === -1)) {
      if (params._301s.indexOf(url) === -1) { // exclude also known 301s
        if (params._5xx.indexOf(url) === -1) { // exclude also known 5xx
          urlsToImport.push(url);
        }
      }
    }
  });

  console.log(`Number of urls to import: ${urlsToImport.length}/${countTotal}`);

  let batch = urlsToImport.slice(0, IMPORT_BATCH_SIZE);
  let round = 0;
  const fullDataSet = [];
  while (batch.length > 0) {
    round += 1;
    // eslint-disable-next-line no-await-in-loop, no-loop-func
    await Promise.all(batch.map(async (u) => {
      console.log(`Importing ${u}`);
      if (await doImport(params, u, fullDataSet)) {
        countSuccess += 1;
      } else {
        countError += 1;
      }
    }));
    const newIndex = IMPORT_BATCH_SIZE * round;
    batch = urlsToImport.slice(newIndex, newIndex + IMPORT_BATCH_SIZE);

    console.log(`Import progress: ${countSuccess + countError}/${urlsToImport.length} (${countSuccess}/${countError})`);
  }

  if (fullDataSet.length > 0) {
    await excelHandler.addRow(
      URLS_XLSX,
      URLS_XLSX_WORKSHEET,
      URLS_XLSX_TABLE,
      fullDataSet,
    );
  }


  return countSuccess;
}

/**
 * This is the main function
 */
async function main(params = {}) {
  const startTime = new Date().getTime();

  const {
    AZURE_ONEDRIVE_CLIENT_ID: oneDriveClientId,
    AZURE_ONEDRIVE_CLIENT_SECRET: oneDriveClientSecret,
    AZURE_ONEDRIVE_REFRESH_TOKEN: oneDriveRefreshToken,
    AZURE_ONEDRIVE_ADMIN_LINK: oneDriveAdminLink,
  } = params;

  try {
    const urlsPath = process.argv[2];

    if (!urlsPath) throw new Error('Please provide the path of the csv file with the posts to import');

    // eslint-disable-next-line no-param-reassign
    params.urlsFile = new CsvFile({
      path: path.resolve(urlsPath),
      headers: ['id', 'link'],
    });

    const _301sPath = process.argv[3];
    // eslint-disable-next-line no-param-reassign
    params._301s = [];
    if (!_301sPath) {
      console.warn('No 301 csv file provided');
    } else {
      // eslint-disable-next-line no-param-reassign
      params._301sFile = new CsvFile({
        path: path.resolve(_301sPath),
        headers: ['link'],
      });
      params._301sFile.readRows((row) => {
        params._301s.push(row.link);
      });
    }

    const _5xxPath = process.argv[4];
    // eslint-disable-next-line no-param-reassign
    params._5xx = [];
    if (!_5xxPath) {
      console.warn('No 5xx csv file provided');
    } else {
      // eslint-disable-next-line no-param-reassign
      params._5xxFile = new CsvFile({
        path: path.resolve(_5xxPath),
        headers: ['link'],
      });
      params._5xxFile.readRows((row) => {
        params._5xx.push(row.link);
      });
    }

    let excelHandler;

    if (oneDriveClientId && oneDriveClientSecret) {
      console.info('OneDrive credentials provided - using OneDrive handler');
      excelHandler = new ExcelHandler({
        console,
        clientId: oneDriveClientId,
        clientSecret: oneDriveClientSecret,
        refreshToken: oneDriveRefreshToken,
        sharedLink: oneDriveAdminLink,
      });

      // eslint-disable-next-line no-param-reassign
      params.mappings = await loadMappings(excelHandler);
    } else {
      console.info('No OneDrive credentials provided');
      throw new Error('Missing OneDrive credentials');
    }

    // load urls already processed
    const rows = await excelHandler.getRows(URLS_XLSX, URLS_XLSX_WORKSHEET, URLS_XLSX_TABLE);

    const count = await doScan(
      params,
      rows.value.map(
        (r) => (r.values.length > 0 && r.values[0].length > 1 ? r.values[0][1] : null),
      ),
      excelHandler,
    );

    console.log();
    console.log(`Imported ${count} post entries.`);
    console.log(`Process took ${(new Date().getTime() - startTime) / 1000}s.`);
  } catch (error) {
    console.error(`An error occured during the full import: ${error.message}.`);
  }
}

main({
  AZURE_ONEDRIVE_CLIENT_ID: process.env.AZURE_ONEDRIVE_CLIENT_ID,
  AZURE_ONEDRIVE_CLIENT_SECRET: process.env.AZURE_ONEDRIVE_CLIENT_SECRET,
  AZURE_ONEDRIVE_REFRESH_TOKEN: process.env.AZURE_ONEDRIVE_REFRESH_TOKEN,
  AZURE_ONEDRIVE_ADMIN_LINK: process.env.AZURE_ONEDRIVE_ADMIN_LINK,
  AZURE_ONEDRIVE_CONTENT_LINK: process.env.AZURE_ONEDRIVE_CONTENT_LINK,
  AZURE_BLOB_SAS: process.env.AZURE_BLOB_SAS,
  AZURE_BLOB_URI: process.env.AZURE_BLOB_URI,
  FASTLY_TOKEN: process.env.FASTLY_TOKEN,
  FASTLY_SERVICE_ID: process.env.FASTLY_SERVICE_ID,
  force: false,
  checkIfRelatedExists: true,
  doCreateAssets: true,
  localStorage: './output',
  cache: './.cache',
  updateExcel: false,
});
