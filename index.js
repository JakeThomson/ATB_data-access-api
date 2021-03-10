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
app.use(bodyParser.json({limit: "50mb"}))
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
				totalProfitLossValue = 0,
				totalProfitLossPercentage = 0,
				isPaused = false,
				totalProfitLossGraph = JSON.stringify({"graph":"placeholder"})

	// Query constructor to update the backtest properties.
	pool.query(`
		UPDATE backtestProperties
		  SET
        backtestDate = ?,
        startBalance = ?,
        totalBalance = ?,
        availableBalance = ?,
        totalProfitLossValue = ?,
        totalProfitLossPercentage = ?,
        isPaused = ?,
        totalProfitLossGraph = ?;
        truncate openTrades;`, 
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
        // Send the new date as an event to the socket connection.
        formattedDate = moment(backtestDate).format('DD/MM/YYYY')
        payload = { backtestDate: formattedDate, availableBalance }
        io.emit("backtestPropertiesUpdated", payload);
			}
	});
})

// Listen for PATCH requests to /backtest_properties/date to set a new date value in the backtest.
app.patch('/backtest_properties/date', (req, res) => {
  // Extract data from request body.
  const { backtest_date: backtestDate } = req.body;

  // Query constructor to update the backtest date.
  pool.query(`
    UPDATE backtestProperties
      SET
        backtestDate = ?`,
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
        io.emit("backtestPropertiesUpdated", payload);
      }
  });
})

// Listen for GET requests to /backtest_properties/date to get the current date in the backtest.
app.get('/backtest_properties', (req, res) => {
	// Query constructor to get the current the backtest date.
	pool.query(`SELECT * FROM backtestProperties;`, (err, row) => {
			if(err) {
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
				delete err.stack;
				console.warn(new Date(), err);
			} else {
				// Valid and successful request, return the formatted date within an object.
        data = row[0]
        data.backtestDate = moment(data.backtestDate).format('DD/MM/YYYY')
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
    INSERT INTO openTrades
      (ticker, buyDate, shareQty, investmentTotal, buyPrice, currentPrice, takeProfit, stopLoss, figure, figurePct)
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
      // Send an event to the UI to tell it to make a GET request to update the list of trades.
      io.emit("tradesUpdated");
    }
  });
})

// Listen for PATCH requests to /backtest_properties/date to set a new date value in the backtest.
app.patch('/backtest_properties/available_balance', (req, res) => {
  // Extract data from request body.
  const { available_balance: availableBalance } = req.body;

  // Query constructor to update the backtest date.
  pool.query(`
    UPDATE backtestProperties
      SET
        availableBalance = ?`,
    [availableBalance], (err, row) => {
      if(err) {
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        delete err.stack;
        console.warn(new Date(), err);
      } else {
        // Valid and successful request.
        res.send(row);
        // Send the new date as an event to the socket connection.
        payload = { availableBalance: availableBalance }
        io.emit("backtestPropertiesUpdated", payload);
      }
  });
})

// Listen for GET requests to /trades to get the current trades in the backtest.
app.get('/trades', (req, res) => {
	// Query constructor to get the current the backtest date.
	pool.query(`SELECT * FROM openTrades;`, (err, row) => {
			if(err) {
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
				delete err.stack;
				console.warn(new Date(), err);
			} else {
				// Valid and successful request, return the formatted date within an object.
        data = row
        // JSON object must be parsed twice for some reason in order for it to be recognised as a JSON object.
        for(i=0; i<data.length; i++) {
          data[i].figure = JSON.parse(JSON.parse(data[i].figure))
        }
				res.send(data);
			}
	});
})

// Listen for PUT requests to /trades to update all open trades and send the closed ones to the closed trades table.
app.put('/trades', (req, res) => {

  const openTrades = req.body.open_trades,
        closedTrades = req.body.closed_trades;
  var openTradeValues = [],
      closedTradeValues = [],
      openTradeMySQLString = "";

  openTrades.forEach(trade => {
    const {trade_id: tradeId, current_price: currentPrice, figure_pct: figurePct} = trade;
    const figure = JSON.stringify(trade.figure);
    values = [currentPrice, figure, figurePct, tradeId];
    openTradeValues.push(...values);
    openTradeMySQLString += "UPDATE openTrades SET currentPrice = ?, figure = ?, figurePct= ? WHERE tradeId = ?;"
  });

  closedTrades.forEach(trade => {
    const {trade_id: tradeId, current_price: currentPrice, figure_pct: figurePct} = trade;
    const figure = JSON.stringify(trade.figure);
    values = [currentPrice, figure, figurePct, tradeId];
    closedTradeValues.push(values);
    console.log(tradeId, currentPrice, figurePct);
  });
  
  if(openTradeValues.length > 0) {
    // Query constructor to update the backtest properties.
    pool.query(openTradeMySQLString,
      openTradeValues, (err, row) => {
        if(err) {
          // If the MySQL query returned an error, pass the error message onto the client.
          res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
          delete err.stack;
          console.warn(new Date(), err);
        } else {
          // Valid and successful request.
          res.send(row);
          io.emit("tradesUpdated");
        }
    });
  }
})

// Listen for PATCH requests to /trades to update a certain trade.
app.patch('/trades/:tradeId', (req, res) => {



  const { current_price: currentPrice, figure_pct: figurePct } = req.body;
  const tradeId  = req.params.tradeId;

  const figure = JSON.stringify(req.body.figure);

  // Query constructor to update data from form into database at the correct row.
  pool.query(`
    UPDATE openTrades
      SET
        currentPrice = ?,
        figure = ?,
        figurePct= ?
      WHERE
        tradeId = ?;`, 
    [currentPrice, figure, figurePct, tradeId], (err, row) => {
      if(err) {
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
				delete err.stack;
				console.warn(new Date(), err);
			} else {
				// Valid and successful request, return the formatted date within an object.
				res.send(row);
        io.emit("tradesUpdated");
			}
	});
})