const packageJson = require('./package.json');
const express = require('express');
const app = express();

const app = express();
const port = 8080;

const server = app.listen(port, () => {
  console.log(`App server now listening to port ${port}`);
});

app.get('/', (req, res) => {
  res.send(`Jake's trading api (version: ${packageJson.version})`);
});