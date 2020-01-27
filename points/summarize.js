'use strict';

const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const dsv = require('d3-dsv');
const geo = require('d3-geo');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const params = {
  TableName: process.env.DYNAMODB_TABLE
};

const s3 = new AWS.S3();

module.exports.run = (event, context, callback) => {
  // fetch all from the database
  dynamoDb.scan(params, (error, result) => {
    // handle potential errors
    if (error) {
      console.error(error);
      return;
    }

    const triesToKeep = [1, 2, 3, 4, 5];

    const items = result.Items.filter(
      item => triesToKeep.indexOf(item.tries) !== -1
    )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(item => {
        const projection = geo
          .geoNaturalEarth1()
          .rotate([0, 0])
          .precision(0.1)
          .fitSize([item.width, item.height], { type: 'Sphere' });

        const coords = projection.invert([item.x, item.y]);

        return {
          country: item.country,
          x: item.x / item.width,
          y: item.y / item.height,
          tries: item.tries,
          mobile: item.width <= 500 ? 1 : 0,
          lat: coords[1],
          long: coords[0]
        };
      });

    const tsv = dsv.tsvFormat(items);

    s3.putObject(
      {
        Bucket: process.env.BUCKET,
        Key: 'tries.tsv',
        Body: Buffer.from(tsv),
        ACL: 'public-read',
        CacheControl: 'max-age=120,public',
        ContentType: 'text/plain; charset=UTF-8'
      },
      () => callback
    );
  });
};
