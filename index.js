const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const moment = require('moment');
const packageJson = require('./package.json');

const app = express();
const port = 8080;
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// Connect to database using env variables.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PWD,
  database: process.env.MYSQL_DB,
});

const server = app.listen(port, () => {
  console.log(`App server now listening to port ${port}`);
});

// Listen for GET requests to '/' and return welcome message with API version number.
app.get('/', (req, res) => {
  res.send(`Jake's trading api (version: ${packageJson.version})`);
});

// Listen for PUT requests to /simulation_properties/initialise and re-initialise the simulation properties.
app.put('/simulation_properties/initialise', (req, res) => {
  // Extract data from request body.
  const { simulation_date: simulationDate, start_balance: startBalance } = req.body;
	
	const totalBalance = startBalance,
				availableBalance = startBalance,
				totalProfitLossValue = "£0.00",
				totalProfitLossPercentage = "0.0%",
				isPaused = false,
				totalProfitLossGraph = JSON.stringify({"graph":"placeholder"})

	// Query constructor to update the simulation properties.
	pool.query(`
		UPDATE simulation_properties
		SET
		simulation_date = ?,
		start_balance = ?,
		total_balance = ?,
		available_balance = ?,
		total_profit_loss_value = ?,
		total_profit_loss_percentage = ?,
		is_paused = ?,
		total_profit_loss_graph = ?`, 
		[simulationDate, startBalance, totalBalance, availableBalance, totalProfitLossValue, 
			totalProfitLossPercentage, isPaused, totalProfitLossGraph], (err, row) => {
			if(err) {
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
				delete err.stack;
				console.log(new Date(), err);
			} else {
				// Valid and successful request.
				res.send(row);
			}
	});
})