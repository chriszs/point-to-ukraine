'use strict';

const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const dsv = require('d3-dsv');
const geo = require('d3-geo');
const array = require('d3-array');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const params = {
  TableName: process.env.DYNAMODB_TABLE,
  ExpressionAttributeValues: {
    ':minTries': 1,
    ':maxTries': 5
  },
  ProjectionExpression: 'country, x, y, width, height',
  FilterExpression: 'tries >= :minTries AND tries <= :maxTries'
};

const s3 = new AWS.S3();

// from https://gist.github.com/ryanhanwu/1ed9cf4b25661ed9ef74d2fe2cab98dd
function dynamoScan() {
  return new Promise((resolve, reject) => {
    let results = [];
    const onScan = (err, { Items, LastEvaluatedKey }) => {
      console.log('page');
      if (err) {
        return reject(err);
      }
      results = results.concat(Items);
      if (typeof LastEvaluatedKey != 'undefined') {
        params.ExclusiveStartKey = LastEvaluatedKey;
        dynamoDb.scan(params, onScan);
      } else {
        return resolve(results);
      }
    };
    dynamoDb.scan(params, onScan);
  });
}

function processItem(item) {
  const projection = geo
    .geoNaturalEarth1()
    .rotate([0, 0])
    .precision(0.1)
    .fitSize([item.width, item.height], { type: 'Sphere' });

  const coords = projection.invert([item.x, item.y]);

  return {
    country: item.country,
    tries: item.tries,
    mobile: item.width <= 500 ? 1 : 0,
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

module.exports.run = (event, context, callback) => {
  console.log('loading');
  dynamoScan()
    .then(results => {
      console.log('processing');

      const items = results.map(processItem);

      const tsv = dsv.tsvFormat(items);
      const sampledTsv = dsv.tsvFormat(array.shuffle(items).slice(0, 2000));

      console.log('writing');
      return Promise.all([
        saveToS3('tries.tsv', tsv),
        saveToS3('sampled-tries.tsv', sampledTsv)
      ]);
    })
    .then(() => callback())
    .catch(err => {
      console.error(err);
      callback(err);
    });
};
