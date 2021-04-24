const express = require('express');
var cors = require('cors');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: ['http://localhost:3000', 'http://localhost:5000', 'https://algo-trader.jake-t.codes'] } });
const mysql = require('mysql');
const bodyParser = require('body-parser');
const moment = require('moment');
const packageJson = require('./package.json');

const port = 8080;

// Set up express settings to work as intended with JSON size limits and CORS policies.
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json({limit: "50mb"}))
app.use(express.static('public'));
app.use(function(req, res, next) {
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:5000', 'https://algo-trader.jake-t.codes'];
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  };
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

let backtestSocket = undefined;

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

// Socket event listeners.
io.on('connection', (socket) => {
  // Send by clients when a connection has been made.
  console.log('a user connected');

  socket.on('backtestAvailability', data => {
    const { backtestOnline } = data
    // Query constructor to update the backtest date.
    pool.query(`
    UPDATE backtests
      SET
        backtestOnline = ?`,
    [backtestOnline], (err, row) => {
      if(err) {
        // If the MySQL query returned an error, log it.
        console.warn(new Date(), err);
      } else {
        // Valid and successful request.
        // Send the new date as an event to the socket connection.
        payload = { backtestOnline: backtestOnline }
        io.emit("backtestUpdated", payload);
      }
    });
  })

  socket.on('restart', (body) => {
    // Called by the UI to initiate a restart in the backend.
    io.emit('restartBacktest');
  })

  socket.on('disconnect', () => {
    // Sent by clients on disconnect.
    console.log('user disconnected');
  });

  socket.on('sendIdentifier', (identifier) => {
    if(identifier === "backtest") {
      backtestSocket = socket;
    }
  })
});

// Listen for PUT requests to /backtest_properties/initialise and re-initialise the backtest properties.
app.put('/backtest_properties/initialise', (req, res) => {
  // Extract data from request body.
  const { start_date: startDate, start_balance: startBalance } = req.body;
	
	const backtestDate = startDate,
        totalBalance = startBalance,
				availableBalance = startBalance,
				totalProfitLoss = 0,
				totalProfitLossPct = 0,
        successRate = 0,
        tradeStats = {highestProfitTrade: undefined, highestLossTrade: undefined, avgProfitPct: undefined, avgLossPct: undefined, 
          avgProfitLossPct: undefined, profitFactor: undefined, totalProfitLoss: undefined};
	var totalProfitLossGraph = JSON.stringify(req.body.total_profit_loss_graph)
	// Query constructor to update the backtest properties.
	pool.query(`
		UPDATE backtests
		  SET
        backtestDate = ?,
        totalBalance = ?,
        availableBalance = ?,
        totalProfitLoss = ?,
        totalProfitLossPct = ?,
        totalProfitLossGraph = ?,
        successRate = ?;
        truncate openTrades;
        truncate closedTrades;`, 
		[backtestDate, totalBalance, availableBalance, totalProfitLoss, 
			totalProfitLossPct, totalProfitLossGraph, successRate], (err, row) => {
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
        payload = { backtestDate: formattedDate, totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph, successRate, tradeStats }
        io.emit("backtestUpdated", payload);
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
    UPDATE backtests
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
        io.emit("backtestUpdated", payload);
      }
  });
})

// Listen for GET requests to /backtest_properties to get the current backtest properties.
app.get('/backtest_properties', (req, res) => {
	// Query constructor to get the current the backtest date.
	pool.query(`SELECT * FROM backtests;`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the properties within an object wit  the date formatted.
        data = row[0];
        data.backtestDate = moment(data.backtestDate).format('DD/MM/YYYY')
				res.send(data);
			}
	});
})

// Listen for GET requests to /backtest_properties/is_paused to get the current pause state of the backtest.
app.get('/backtest_properties/is_paused', (req, res) => {
	// Query constructor to get the current pause state of the backtest.
	pool.query(`SELECT isPaused FROM backtests;`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return thepaused state within an object.
        data = row[0];
				res.send(data);
			}
	});
})

// Listen for PATCH requests to /backtest_properties/is_paused to set the current pause state of the backtest.
app.patch('/backtest_properties/is_paused', (req, res) => {
	// Query constructor to get the current the backtest date.
  const { isPaused } = req.body;

	 // Query constructor to update the backtest paused state.
   pool.query(`
   UPDATE backtests
     SET
       isPaused = ?`,
   [isPaused], (err, row) => {
     if(err) {
       console.warn(new Date(), err);
       // If the MySQL query returned an error, pass the error message onto the client.
       res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
     } else {
       // Valid and successful request.
       res.send(row);
       // Send the new paused state as an event to the socket connection.
       payload = { isPaused: isPaused }
       io.emit("backtestUpdated", payload);
       io.emit("playpause", payload);
     }
 });
})

// Listen for PATCH requests to /backtest_properties/is_paused to set the current pause state of the backtest.
app.patch('/backtest_properties/available', (req, res) => {
	// Query constructor to get the current the backtest date.
  const backtestOnline  = parseInt(req.body.backtestOnline);

  if(backtestOnline === 0) {
    backtestSocket = undefined;
  }

  // Query constructor to update the backtest paused state.
  pool.query(`
  UPDATE backtests
    SET
      backtestOnline = ?`,
  [backtestOnline], (err, row) => {
    if(err) {
      console.warn(new Date(), err);
      // If the MySQL query returned an error, pass the error message onto the client.
      res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
    } else {
      // Valid and successful request.
      res.send(row);
      // Send the new backtest availability state as an event to the socket connection.
      payload = { backtestOnline: backtestOnline }
      io.emit("backtestUpdated", payload);
      console.log(`Backtest is ${backtestOnline === 1 ? "online" : "offline"}.`)
    }
 });
})

// Listen for PATCH requests to /backtest_properties/date to set a new date value in the backtest.
app.put('/backtest_properties', (req, res) => {
  // Extract data from request body.
  const { total_balance: totalBalance, available_balance: availableBalance, total_profit_loss: totalProfitLoss, total_profit_loss_pct: totalProfitLossPct } = req.body;
  
  var  totalProfitLossGraph = JSON.stringify(req.body.total_profit_loss_graph);
  
  // Query constructor to update the backtest properties.
  pool.query(`
    UPDATE backtests
      SET
        totalBalance = ?,
        availableBalance = ?,
        totalProfitLoss = ?,
        totalProfitLossPct = ?,
        totalProfitLossGraph = ?,
        successRate = IFNULL((SELECT (SUM(profitLoss >= 0)/count(*))*100 FROM closedTrades), 0);
        SELECT (SUM(profitLoss >= 0)/count(*))*100 AS 'successRate' FROM closedTrades;`,
    [totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph], (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request.
        res.send(row);
        const successRate = row[1][0].successRate;
        // Send the new date as an event to the socket connection.
        totalProfitLossGraph = JSON.parse(totalProfitLossGraph);
        payload = { totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph, successRate }
        io.emit("backtestUpdated", payload);
      }
  });
})

// Listen for GET requests to /backtest_properties to get the current backtest properties.
app.get('/backtest_settings', (req, res) => {
	// Query constructor to get the current the backtest date.
	pool.query(`SELECT backtestSettings.*, strategies.strategyName FROM backtestSettings
              LEFT JOIN strategies ON (backtestSettings.strategyId=strategies.strategyId);`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the properties within an object wit the date formatted.
        data = row[0];
        data.startDate = moment(data.startDate);
        data.endDate = moment(data.endDate);
				res.send(data);
			}
	});
})

// Listen for PUT requests to /backtest_settings to the backtest settings.
app.put('/backtest_settings', (req, res) => {
  // Extract data from request body.
  const { startBalance, marketIndex, capPct, takeProfit, stopLoss } = req.body;
  const startDate = moment(req.body.startDate).format("YYYY-MM-DD"),
        endDate = moment(req.body.endDate).format("YYYY-MM-DD");
  
  // Query constructor to update the backtest settings.
  pool.query(`
    UPDATE backtestSettings
      SET
        startDate = ?,
        endDate = ?,
        startBalance = ?,
        marketIndex = ?,
        capPct = ?,
        takeProfit = ?,
        stopLoss = ?;`,
    [startDate, endDate, startBalance, marketIndex, capPct, takeProfit, stopLoss], (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request.
        res.send(row);
      }
  });
})

// Listen for PUT requests to /backtest_settings to the backtest settings.
app.put('/backtest_settings/strategy', (req, res) => {
  // Extract data from request body.
  const { strategyId } = req.body;
  
  // Query constructor to update the backtest settings.
  pool.query(`
    UPDATE backtestSettings
      SET
        strategyId = ?;`,
    [strategyId], (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request.
        res.send(row);
      }
  });
})

// Listen for POST requests to /trades to add a new trade to the open_trades table.
app.post('/trades', (req, res) => {

  const { ticker, buy_date: buyDate, share_qty: shareQty, investment_total: investmentTotal, buy_price: buyPrice, 
    current_price: currentPrice, take_profit: takeProfit, stop_loss: stopLoss, profit_loss_pct: profitLossPct } = req.body;
  
  const figure = JSON.stringify(req.body.figure);

  // Query constructor to send a new trade to openTrades.
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

// Listen for GET requests to /trades to get the current trades in the backtest.
app.get('/trades', (req, res) => {
	// Query constructor to get all current open and closed trades..
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
        // Separate and parse the two results for the UI to easily use.
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

  // Generate MySQL query string and inputs, to allow the backtest to update all required trades in the openTrades table.
  openTrades.forEach(trade => {
    const {trade_id: tradeId, current_price: currentPrice, profit_loss_pct: profitLossPct} = trade;
    const figure = JSON.stringify(trade.figure);
    values = [currentPrice, figure, profitLossPct, tradeId];
    openTradeValues.push(...values);
    openTradeMySQLString += "UPDATE openTrades SET currentPrice = ?, figure = ?, profitLossPct= ? WHERE tradeId = ?;"
  });

  // Generate MySQL query string and inputs, to allow the backtest to add all required trades in the closedTrades table.
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
    // Query constructor to update the open trades.
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
    // Query constructor to move trades from the openTrades table to closedTrades.
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
  if(closedTradeValues.length > 0) {
    io.emit("updateStats");
  }
})

// Listen for GET requests to /trades/stats to get the current trade statistics of the backtest from the date specified.
app.get('/trades/stats', (req, res) => {
  const date = req.query.date;

  if(date === undefined) {
    // If the date was not defined in the request query params, pass the error message onto the client.
    res.status(400).send("Invalid query.");
  }

  const sqlParamArray = Array(8).fill(date);
	// Query constructor to get all current backtest stats.
	pool.query(`
    SELECT *
      FROM closedTrades
        WHERE profitLossPct = (SELECT MAX(profitLossPct) FROM closedTrades WHERE profitLoss > 0 AND sellDate >= ?);
    SELECT *
      FROM closedTrades
        WHERE profitLossPct = (SELECT MIN(profitLossPct) FROM closedTrades WHERE profitLoss < 0 AND sellDate >= ?);
    SELECT AVG(profitLossPct) AS avgProfitPct
      FROM closedTrades
        WHERE profitLossPct > 0 AND sellDate >= ?;
    SELECT AVG(profitLossPct) AS avgLossPct
      FROM closedTrades
        WHERE profitLossPct < 0 AND sellDate >= ?;
    SELECT AVG(profitLossPct) as avgProfitLossPct
      FROM closedTrades
        WHERE sellDate > ?;
    SELECT (SELECT COUNT(profitLoss) FROM closedTrades WHERE profitLoss > 0 AND sellDate >= ?)/
          (SELECT COUNT(profitLoss) FROM closedTrades WHERE profitLoss < 0 AND sellDate >= ?) AS profitFactor;
    SELECT (SELECT SUM(profitLoss) FROM closedTrades WHERE sellDate >= ?)/
          (SELECT COUNT(profitLoss) FROM closedTrades) * 100 AS totalProfitLoss;`,
          sqlParamArray, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
        // Format results into a usable object to be sent to the client.
        const highestProfitTrade = row[0][0];
        if(highestProfitTrade !== undefined){
          highestProfitTrade.figure = JSON.parse(JSON.parse(highestProfitTrade.figure));
        }
        const highestLossTrade = row[1][0];
        if(highestLossTrade !== undefined){
          highestLossTrade.figure = JSON.parse(JSON.parse(highestLossTrade.figure));
        }
				const data = {highestProfitTrade, highestLossTrade, avgProfitPct: row[2][0].avgProfitPct, avgLossPct: row[3][0].avgLossPct, 
          avgProfitLossPct: row[4][0].avgProfitLossPct, profitFactor: row[5][0].profitFactor, totalProfitLoss: row[6][0].totalProfitLoss};
				res.send(data);
			}
	});
})

// Listen for GET requests to /strategies/modules to get the current available modules from the backend, OR from the databse if backend is offline.
app.get('/strategies/modules', (req, res) => {

  // Called if backtest is online.
  function updateAvailableModules(modules) {
    // Query string builder to execute multiple requests in one connection. 
    // Start with 
    let sqlQuery = "truncate availableModules;"
    let sqlQueryParams = [];
    for (module in modules) {
      sqlQuery += 'INSERT INTO availableModules (moduleName, formConfiguration) VALUES (?, ?);'
      sqlQueryParams = sqlQueryParams.concat([module, JSON.stringify(modules[module])]);
    }

    pool.query(sqlQuery, sqlQueryParams);
  }
  
  // If the backtest socket connection can be idenfified (is online), then get available modules from the backtesting platform.
  if(backtestSocket !== undefined) {
    // Emit message for backtest to receive and return data.
    backtestSocket.emit("getAnalysisModules", null, (result) => {
      // Update available module data in databse cache.
      updateAvailableModules(result);
      res.send(result);
    });
  } else {
    // If  backtest socket connection cannot be idenfified (is offline), then get cached available modules from database.
    // Query constructor to get the current pause state of the backtest.
    pool.query(`SELECT * FROM availableModules;`, (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request, format data and return.
        let data = {}
        for(let i=0; i<row.length; i++) {
          data[row[i].moduleName] = JSON.parse(row[i].formConfiguration);
        }
        res.send(data);
      }
  });
  }
})

// Listen for GET requests to /strategies to get the current saved strategies in the databse.
app.get('/strategies', (req, res) => {
	// Query constructor to get the current saved strategies.
	pool.query(`SELECT * FROM strategies;`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, format data and return.
        data = row
        for(i=0; i<row.length; i++){
          data[i].technicalAnalysis = JSON.parse(data[i].technicalAnalysis);
          data[i].lastRun = "12m ago", 
          data[i].active = false, 
          data[i].avgSuccess = Math.round((i+1)*2*13.3),
          data[i].avgReturns = Math.round((i+1)*2*9.3)
        }
				res.send(data);
			}
	});
})

// Listen for POST requests to /strategies to add a new strategy to the database.
app.post('/strategies', (req, res) => {

  // Extract data from request body.
  let { strategyName, strategyData } = req.body;

  // Convert json object into json string that can be accepted by the database.
  strategyData = JSON.stringify(strategyData)

  // Query constructor to send a new strategu to the database.
	pool.query(`
    INSERT INTO strategies
      (strategyName, technicalAnalysis, lookbackRangeWeeks, maxWeekPeriod)
    VALUES
      (?, ?, ?, ?);
    SELECT LAST_INSERT_ID() AS strategyId;`, 
  [strategyName, strategyData, 34, 40], (err, row) => {
    if(err) {
      console.warn(new Date(), err);
      // If the MySQL query returned an error, pass the error message onto the client.
      res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
    } else {
      // Valid and successful request, return the strategyId in the response body.
      res.send(row[1][0]);
    }
  });
})

// Listen for GET requests to /strategies/:strategyId to get information on a specific strategy.
app.get('/strategies/:strategyId', (req, res) => {
  const strategyId = req.params.strategyId;

	// Query constructor to get infor on backtest.
	pool.query(`SELECT * FROM strategies WHERE strategyId = ?;`, [strategyId], (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, parse the json technical analysis data and return the results.
        data = row[0]
        if(data !== undefined) {
          data.technicalAnalysis = JSON.parse(data.technicalAnalysis);
        }
				res.send(data);
			}
	});
})

// Listen for PUT requests to /strategies/:strategyId and update the specified strategy.
app.put('/strategies/:strategyId', (req, res) => {

  // Extract data from request body.
  let { strategyName, strategyData, } = req.body;
  const strategyId = req.params.strategyId;

  strategyData = JSON.stringify(strategyData);

	// Query constructor to update the specified strategy.
	pool.query(`
    UPDATE strategies
      SET
        strategyName = ?,
        technicalAnalysis = ?
      WHERE
        strategyID = ?;`, 
		[strategyName, strategyData, strategyId], (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request.
				res.send(row);
			}
	});
})

// Listen for DELETE requests to /strategies and delete the specified entry in the table.
app.delete('/strategies/:strategyId', (req, res) => {
  // Extract data from route parameter.
  const strategyId  = parseInt(req.params.strategyId);
  
  // Query constructor to remove row from strategies.
  pool.query(`DELETE FROM strategies
              WHERE strategyId = ?;`, [strategyId], (err, row) => {
    // If strategyId does not exist, then it was not provided in the request.
    if(strategyId === undefined) { 
      res.status(400).send({devErrorMsg: "Invalid query parameter 'strategyId'.", clientErrorMsg: "Internal error."});
    } else {
      if(err) {
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        delete err.stack;
        console.log(new Date(), err);
      } else {
        if(row.affectedRows === 0) {
          // If no rows are affected, then there was no strategy with an ID that matched the provided strategyId.
          res.status(404).send({devErrorMsg: `RequestId '${strategyId}' doesn't exist in mileage database.`, clientErrorMsg: "Entry no longer exists."});
        } else {
          // Valid and successful request.
          // Emit message for backtest to stop backtest if it is running the strategy just deleted.
          backtestSocket.emit("stopBacktest", strategyId, "Strategy in use was deleted");
          res.send(row);
        }
      }
    }
  });
});