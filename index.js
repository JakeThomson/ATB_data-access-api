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
				totalProfitLoss = 0,
				totalProfitLossPct = 0,
				isPaused = false;
	var totalProfitLossGraph = JSON.stringify(req.body.total_profit_loss_graph)

	// Query constructor to update the backtest properties.
	pool.query(`
		UPDATE backtestProperties
		  SET
        backtestDate = ?,
        startBalance = ?,
        totalBalance = ?,
        availableBalance = ?,
        totalProfitLoss = ?,
        totalProfitLossPct = ?,
        isPaused = ?,
        totalProfitLossGraph = ?;
        truncate openTrades;
        truncate closedTrades;`, 
		[backtestDate, startBalance, totalBalance, availableBalance, totalProfitLoss, 
			totalProfitLossPct, isPaused, totalProfitLossGraph], (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request.
				res.send(row);
        // Send the new date as an event to the socket connection.
        formattedDate = moment(backtestDate).format('DD/MM/YYYY')
        totalProfitLossGraph = JSON.parse(totalProfitLossGraph);
        payload = { backtestDate: formattedDate, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph }
        io.emit("backtestPropertiesUpdated", payload);
        io.emit("tradesUpdated");
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
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
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
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
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
    current_price: currentPrice, take_profit: takeProfit, stop_loss: stopLoss, profit_loss_pct: profitLossPct } = req.body;
  
  const figure = JSON.stringify(req.body.figure);


  // Query constructor to update the backtest properties, it returns the trade_id in the response object.
	pool.query(`
    INSERT INTO openTrades
      (ticker, buyDate, shareQty, investmentTotal, buyPrice, currentPrice, takeProfit, stopLoss, figure, profitLossPct)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    SELECT LAST_INSERT_ID() AS trade_id;`, 
  [ticker, buyDate, shareQty, investmentTotal, buyPrice, currentPrice, takeProfit, stopLoss, figure, profitLossPct], (err, row) => {
    if(err) {
      console.warn(new Date(), err);
      // If the MySQL query returned an error, pass the error message onto the client.
      res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
    } else {
      // Valid and successful request, return the trade_id in the response body.
      res.send(row[1][0]);
      // Send an event to the UI to tell it to make a GET request to update the list of trades.
      io.emit("tradesUpdated");
    }
  });
})

// Listen for PATCH requests to /backtest_properties/date to set a new date value in the backtest.
app.put('/backtest_properties', (req, res) => {
  // Extract data from request body.
  const { total_balance: totalBalance, available_balance: availableBalance, total_profit_loss: totalProfitLoss, total_profit_loss_pct: totalProfitLossPct } = req.body;
  
  var  totalProfitLossGraph = JSON.stringify(req.body.total_profit_loss_graph);
  
  // Query constructor to update the backtest date.
  pool.query(`
    UPDATE backtestProperties
      SET
        totalBalance = ?,
        availableBalance = ?,
        totalProfitLoss = ?,
        totalProfitLossPct = ?,
        totalProfitLossGraph = ?;`,
    [totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph], (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request.
        res.send(row);
        // Send the new date as an event to the socket connection.
        totalProfitLossGraph = JSON.parse(totalProfitLossGraph);
        payload = { totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph }
        io.emit("backtestPropertiesUpdated", payload);
      }
  });
})

// Listen for GET requests to /trades to get the current trades in the backtest.
app.get('/trades', (req, res) => {
	// Query constructor to get the current the backtest date.
	pool.query(`
    SELECT * FROM openTrades; SELECT * FROM closedTrades;
    SELECT * FROM (
      SELECT * FROM closedTrades ORDER BY \`index\` DESC LIMIT 10
    ) sub;`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the formatted date within an object.
        data = [row[0], row[2]]
        // JSON object must be parsed twice for some reason in order for it to be recognised as a JSON object.
        for(i=0; i<data[0].length; i++) {
          data[0][i].figure = JSON.parse(JSON.parse(data[0][i].figure))
        }
        for(i=0; i<data[1].length; i++) {
          data[1][i].figure = JSON.parse(JSON.parse(data[1][i].figure))
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
      openTradeMySQLString = "",
      closedTradeMySQLString = "";

  openTrades.forEach(trade => {
    const {trade_id: tradeId, current_price: currentPrice, profit_loss_pct: profitLossPct} = trade;
    const figure = JSON.stringify(trade.figure);
    values = [currentPrice, figure, profitLossPct, tradeId];
    openTradeValues.push(...values);
    openTradeMySQLString += "UPDATE openTrades SET currentPrice = ?, figure = ?, profitLossPct= ? WHERE tradeId = ?;"
  });

  closedTrades.forEach(trade => {
    const {trade_id: tradeId, ticker, buy_date: buyDate, sell_date: sellDate, share_qty: shareQty, investment_total: investmentTotal, profit_loss: profitLoss,
      buy_price: buyPrice, sell_price: sellPrice, take_profit: takeProfit, stop_loss: stopLoss, profit_loss_pct: profitLossPct} = trade;
    const figure = JSON.stringify(trade.figure);
    values = [tradeId, ticker, buyDate, sellDate, shareQty, investmentTotal, profitLoss, buyPrice, sellPrice, takeProfit, stopLoss, figure, profitLossPct, tradeId];
    closedTradeValues.push(...values);
    closedTradeMySQLString += "INSERT INTO closedTrades (tradeId, ticker, buyDate, sellDate, shareQty, investmentTotal, profitLoss, buyPrice, \
      sellPrice, takeProfit, stopLoss, figure, profitLossPct)\ VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);\
      DELETE FROM openTrades WHERE tradeId = ?;"
  });
  
  result = []

  if(openTradeValues.length > 0) {
    // Query constructor to update the backtest properties.
    pool.query(openTradeMySQLString,
      openTradeValues, (err, row) => {
        if(err) {
          console.warn(new Date(), err);
          // If the MySQL query returned an error, pass the error message onto the client.
          res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        } else {
          // Valid and successful request.
          result.push(row);
        }
    });
  }
  if(closedTradeValues.length > 0) {
    // Query constructor to update the backtest properties.
    pool.query(closedTradeMySQLString,
      closedTradeValues, (err, row) => {
        if(err) {
          console.warn(new Date(), err);
          // If the MySQL query returned an error, pass the error message onto the client.
          res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        } else {
          // Valid and successful request.
          result.push(row);
        }
    });
  }
  res.send(result);
  io.emit("tradesUpdated");
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
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the formatted date within an object.
				res.send(row);
        io.emit("tradesUpdated");
			}
	});
})