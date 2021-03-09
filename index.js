const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: ['http://localhost:3000', 'http://localhost:5000', 'https://algo-trader.jake-t.codes'], } });
const mysql = require('mysql');
const bodyParser = require('body-parser');
const socket = require('socket.io');
const moment = require('moment');
const packageJson = require('./package.json');

const port = 8080;



app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(express.static('public'));
app.use(function(req, res, next) {
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:5000', 'https://algo-trader.jake-t.codes'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
       res.setHeader('Access-Control-Allow-Origin', origin);
  };
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Connect to database using env variables.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PWD,
  database: process.env.MYSQL_DB,
  multipleStatements: true
});

const server = http.listen(port, () => {
  console.log(`App server now listening to port ${port}`);
});

// Listen for GET requests to '/' and return welcome message with API version number.
app.get('/', (req, res) => {
  res.send(`Jake's trading api (version: ${packageJson.version})`);
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Listen for PUT requests to /backtest_properties/initialise and re-initialise the backtest properties.
app.put('/backtest_properties/initialise', (req, res) => {
  // Extract data from request body.
  const { backtest_date: backtestDate, start_balance: startBalance } = req.body;
	
	const totalBalance = startBalance,
				availableBalance = startBalance,
				totalProfitLossValue = "£0.00",
				totalProfitLossPercentage = "0.0%",
				isPaused = false,
				totalProfitLossGraph = JSON.stringify({"graph":"placeholder"})

	// Query constructor to update the backtest properties.
	pool.query(`
		UPDATE backtest_properties
		  SET
        backtest_date = ?,
        start_balance = ?,
        total_balance = ?,
        available_balance = ?,
        total_profit_loss_value = ?,
        total_profit_loss_percentage = ?,
        is_paused = ?,
        total_profit_loss_graph = ?`, 
		[backtestDate, startBalance, totalBalance, availableBalance, totalProfitLossValue, 
			totalProfitLossPercentage, isPaused, totalProfitLossGraph], (err, row) => {
			if(err) {
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
				delete err.stack;
				console.warn(new Date(), err);
			} else {
				// Valid and successful request.
				res.send(row);
			}
	});
})

// Listen for PATCH requests to /backtest_properties/date to set a new date value in the backtest.
app.patch('/backtest_properties/date', (req, res) => {
  // Extract data from request body.
  const { backtest_date: backtestDate } = req.body;

  // Query constructor to update the backtest date.
  pool.query(`
    UPDATE backtest_properties
      SET
        backtest_date = ?`,
    [backtestDate], (err, row) => {
      if(err) {
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        delete err.stack;
        console.warn(new Date(), err);
      } else {
        // Valid and successful request.
        res.send(row);
        // Send the new date as an event to the socket connection.
        formattedDate = moment(backtestDate).format('DD/MM/YYYY')
        payload = { backtestDate: formattedDate }
        io.emit("dateUpdated", payload);
      }
  });
})

// Listen for GET requests to /backtest_properties/date to get the current date in the backtest.
app.get('/backtest_properties/date', (req, res) => {

	// Query constructor to get the current the backtest date.
	pool.query(`SELECT backtest_date FROM backtest_properties;`, (err, row) => {
			if(err) {
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
				delete err.stack;
				console.warn(new Date(), err);
			} else {
				// Valid and successful request, return the formatted date within an object.
        data = row[0]
        data.backtest_date = moment(data.backtest_date).format('DD/MM/YYYY')
				res.send(data);
			}
	});
})

// Listen for POST requests to /trades to add a new trade to the open_trades table.
app.post('/trades', (req, res) => {

  const { ticker, buy_date: buyDate, share_qty: shareQty, investment_total: investmentTotal, buy_price: buyPrice, 
    current_price: currentPrice, take_profit: takeProfit, stop_loss: stopLoss, figure_pct: figurePct } = req.body;
  
  const figure = JSON.stringify(req.body.figure);


  // Query constructor to update the backtest properties, it returns the trade_id in the response object.
	pool.query(`
    INSERT INTO open_trades
      (ticker, buy_date, share_qty, investment_total, buy_price, current_price, take_profit, stop_loss, figure, figure_pct)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    SELECT LAST_INSERT_ID() AS trade_id;`, 
  [ticker, buyDate, shareQty, investmentTotal, buyPrice, currentPrice, takeProfit, stopLoss, figure, figurePct], (err, row) => {
    if(err) {
      // If the MySQL query returned an error, pass the error message onto the client.
      res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      delete err.stack;
      console.warn(new Date(), err);
    } else {
      // Valid and successful request, return the trade_id in the response body.
      res.send(row[1][0]);
    }
  });
})

// Listen for PATCH requests to /backtest_properties/date to set a new date value in the backtest.
app.patch('/backtest_properties/available_balance', (req, res) => {
  // Extract data from request body.
  const { available_balance: availableBalance } = req.body;

  // Query constructor to update the backtest date.
  pool.query(`
    UPDATE backtest_properties
      SET
        available_balance = ?`,
    [availableBalance], (err, row) => {
      if(err) {
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        delete err.stack;
        console.warn(new Date(), err);
      } else {
        // Valid and successful request.
        res.send(row);
        // // Send the new date as an event to the socket connection.
        // formattedDate = moment(backtestDate).format('DD/MM/YYYY')
        // payload = { backtestDate: formattedDate }
        // io.emit("dateUpdated", payload);
      }
  });
})