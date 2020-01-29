'use strict';

const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const dsv = require('d3-dsv');
const geo = require('d3-geo');
const array = require('d3-array');
const ScanPaginator = require('@aws/dynamodb-query-iterator').ScanPaginator;

const s3 = new AWS.S3();

function dynamoScan() {
  return new ScanPaginator(new AWS.DynamoDB({ region: 'us-east-1' }), {
    TableName: process.env.DYNAMODB_TABLE,
    ExpressionAttributeValues: {
      ':minTries': { N: '1' },
      ':maxTries': { N: '5' },
      ':maxTime': { N: '1580151600000' }
    },
    Limit: 5000,
    ProjectionExpression: 'country, x, y, width, height, tries',
    FilterExpression: 'tries >= :minTries AND tries <= :maxTries AND createdAt <= :maxTime'
  });
}

function processItem(item) {
  const projection = geo
    .geoNaturalEarth1()
    .rotate([0, 0])
    .precision(0.1)
    .fitSize([+item.width.N, +item.height.N], { type: 'Sphere' });

  const coords = projection.invert([+item.x.N, +item.y.N]);

  return {
    country: item.country.S,
    tries: +item.tries.N,
    mobile: (+item.width.N) <= 500 ? 1 : 0,
    lat: coords[1],
    long: coords[0]
  };
}

function saveToS3(key, data) {
  return new Promise((resolve, reject) => {
    s3.putObject(
      {
        Bucket: process.env.BUCKET,
        Key: key,
        Body: Buffer.from(data),
        ACL: 'public-read',
        CacheControl: 'max-age=120,public',
        ContentType: 'text/plain; charset=UTF-8'
      },
      err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

module.exports.run = async (event, context, callback) => {
  console.log('loading');
  const results = dynamoScan();

  let items = [];

  for await (const page of results) {
    console.log('page');
    items = items.concat(page.Items.map(processItem));
  }

  const tsv = dsv.tsvFormat(items);
  const sampledTsv = dsv.tsvFormat(array.shuffle(items).slice(0, 3000));

  console.log('writing');

  Promise.all([
    saveToS3('tries.tsv', tsv),
    saveToS3('sampled-tries.tsv', sampledTsv)
  ])
    .then(() => callback())
    .catch(err => {
      console.error(err);
      callback(err);
    });
};
