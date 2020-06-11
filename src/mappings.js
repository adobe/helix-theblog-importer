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
/* eslint-disable max-len */

const MAPPINGS_XLSX = '/importer/mappings.xlsx';

const MAPPINGS_XLSX_CATEGORIES_WORKSHEET = 'Migration - Topic to Category';
const MAPPINGS_XLSX_CATEGORIES_TABLE = 'categories';

const MAPPINGS_XLSX_PRODUCTS_WORKSHEET = 'Migration - Products';
const MAPPINGS_XLSX_PRODUCTS_TABLE = 'products';

async function load(excelHandler) {
  const mappings = {
    categories: {},
    products: {},
    productKeywords: {
      photoshop: 'photoshop',
      'adobe illustrator': 'illustrator',
      'premiere pro': 'premiere pro',
      'adobe premiere': 'premiere pro',
    },
  };

  const categoryRows = await excelHandler.getRows(MAPPINGS_XLSX, MAPPINGS_XLSX_CATEGORIES_WORKSHEET, MAPPINGS_XLSX_CATEGORIES_TABLE);
  categoryRows.value.forEach((row) => {
    if (row && row.values && row.values.length > 0 && row.values[0].length > 1) {
      const category = row.values[0];

      // Creativity>Art or Creativity
      const s = category[0].split('>');
      const oldTopic = s[s.length - 1].trim().toLowerCase();

      // Insights Inspiration, Creativity, Art
      const newCats = category[1].split(',');

      // Art = [Art, Creativity, Insights Inspiration]
      // reversing to get more specific first
      mappings.categories[oldTopic] = newCats.reverse().map((t) => t.trim());
    }
  });

  const productsRows = await excelHandler.getRows(MAPPINGS_XLSX, MAPPINGS_XLSX_PRODUCTS_WORKSHEET, MAPPINGS_XLSX_PRODUCTS_TABLE);
  productsRows.value.forEach((row) => {
    if (row && row.values && row.values.length > 0 && row.values[0].length > 1) {
      const product = row.values[0];
      // Products>Experience Cloud>Experience Manager
      const s = product[0].split('>');
      const oldProductName = s[s.length - 1].trim().toLowerCase();

      // Experience Cloud, Experience Manager
      // reversing to get more specific first
      const newProducts = product[1].split(',');

      // Experience Manager = [Experience Manager, Experience Cloud]
      mappings.products[oldProductName] = newProducts.reverse().map((t) => t.trim());
    }
  });

  return mappings;
}

module.exports = { load };
