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
    UPDATE backtestSettings
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

// Listen for GET requests to /backtests to get the current backtest properties.
app.get('/backtests', (req, res) => {
	// Query constructor to get the current the backtest date.
	pool.query(`
        SELECT
            backtests.*, backtestSettings.startDate
        FROM
            backtests
        INNER JOIN
            backtestSettings
        ORDER BY backtestId DESC LIMIT 1;`, (err, row) => {
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

// Listen for POST requests to /backtests and create a new backtest.
app.post('/backtests', (req, res) => {
  // Extract data from request body.
  const { start_date: startDate, start_balance: startBalance, strategy_id: strategyId } = req.body;
	
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
    DELETE FROM backtests WHERE datetimeFinished is null;
		INSERT INTO backtests 
      (backtestDate, strategyId, datetimeStarted, active, totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph, successRate)
    VALUES
      (?, ?, NOW(), 1, ?, ?, ?, ?, ?, ?);
    SELECT LAST_INSERT_ID() AS backtestId;`, 
		[backtestDate, strategyId, totalBalance, availableBalance, totalProfitLoss, 
			totalProfitLossPct, totalProfitLossGraph, successRate], (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the backtestId in the response body.
        res.send(row[2][0]);
        // Send the new date as an event to the socket connection.
        formattedDate = moment(backtestDate).format('DD/MM/YYYY')
        totalProfitLossGraph = JSON.parse(totalProfitLossGraph);
        payload = { backtestId: row[2][0].backtestId, strategyId, backtestDate: formattedDate, totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph, successRate, tradeStats }
        io.emit("backtestUpdated", payload);
        io.emit("tradesUpdated");
			}
	});
})

// Listen for PATCH requests to /backtests/?/date to set a new date value in the backtest.
app.patch('/backtests/:backtestId/date', (req, res) => {
  const backtestId = parseInt(req.params.backtestId);

  // Extract data from request body.
  const { backtest_date: backtestDate } = req.body;

  // Query constructor to update the backtest date.
  pool.query(`
    UPDATE backtests
      SET
        backtestDate = ?
      WHERE backtestId = ?`,
    [backtestDate, backtestId], (err, row) => {
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

// Listen for PUT requests to /backtests/? to set a new date value in the backtest.
app.put('/backtests/:backtestId', (req, res) => {
  const backtestId = parseInt(req.params.backtestId);

  // Extract data from request body.
  const { total_balance: totalBalance, strategy_id: strategyId, available_balance: availableBalance, total_profit_loss: totalProfitLoss, total_profit_loss_pct: totalProfitLossPct } = req.body;
  
  var  totalProfitLossGraph = JSON.stringify(req.body.total_profit_loss_graph);
  
  // Query constructor to update the backtest.
  pool.query(`
    UPDATE backtests
      SET
        totalBalance = ?,
        availableBalance = ?,
        totalProfitLoss = ?,
        totalProfitLossPct = ?,
        totalProfitLossGraph = ?,
        successRate = IFNULL((SELECT (SUM(profitLoss >= 0)/count(*))*100 FROM closedTrades WHERE backtestId = ?), 0)
      WHERE backtestId = ?;
        SELECT (SUM(profitLoss >= 0)/count(*))*100 AS 'successRate' FROM closedTrades WHERE backtestId = ?;`,
    [totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph, backtestId, backtestId, backtestId], (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request.
        res.send(row);
        const successRate = row[1][0].successRate;
        // Send the new backtest data as an event to the socket connection.
        totalProfitLossGraph = JSON.parse(totalProfitLossGraph);
        payload = { backtestId, strategyId, totalBalance, availableBalance, totalProfitLoss, totalProfitLossPct, totalProfitLossGraph, successRate }
        io.emit("backtestUpdated", payload);
      }
  });
})

// Listen for put requests to /backtests/?/finalise to update the final state of the backtest in teh database.
app.put('/backtests/:backtestId/finalise', (req, res) => {
  const backtestId = parseInt(req.params.backtestId);
  
  // Query constructor to update the backtest.
  pool.query(`
    UPDATE backtests
      SET
        datetimeFinished = NOW(),
        active = 0
      WHERE backtestId = ?;`,
    [backtestId], (err, row) => {
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

// Listen for GET requests to /backtests_settings to get the current backtest settings.
app.get('/backtest_settings', (req, res) => {
	// Query constructor to get the current the backtest settings.
	pool.query(`SELECT backtestSettings.*, strategies.strategyName FROM backtestSettings
              LEFT JOIN strategies ON (backtestSettings.strategyId=strategies.strategyId);`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the properties within an object with the date formatted.
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
// Listen for GET requests to /backtests/is_paused to get the current pause state of the backtest.
app.get('/backtest_settings/is_paused', (req, res) => {
	// Query constructor to get the current pause state of the backtest.
	pool.query(`SELECT isPaused FROM backtestSettings;`, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the paused state within an object.
        data = row[0];
				res.send(data);
			}
	});
})

// Listen for PATCH requests to /backtests/is_paused to set the current pause state of the backtest.
app.patch('/backtest_settings/is_paused', (req, res) => {
	// Query constructor to get the current the backtest date.
  const { isPaused } = req.body;

	 // Query constructor to update the backtest paused state.
   pool.query(`
   UPDATE backtestSettings
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

// Listen for PATCH requests to /backtest_settings/available to set the current availability of the backtesting platform.
app.patch('/backtest_settings/available', (req, res) => {
	// Query constructor to get the current the backtest date.
  const backtestOnline  = parseInt(req.body.backtestOnline);

  // Query constructor to update the backtest paused state.
  pool.query(`
  UPDATE backtests
      SET
        active = 0;
  UPDATE backtestSettings
    SET
      backtestOnline = ?;`,
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

// Listen for GET requests to /backtest_settings/available to get the current availability of the backtesting platform.
app.get('/backtest_settings/available', (req, res) => {
	// Query constructor to get the current the backtest status.
  const backtestOnline  = parseInt(req.body.backtestOnline);

  if(backtestOnline === 0) {
    backtestSocket = undefined;
  }

  // Query constructor to update the backtest paused state.
  pool.query(`
  SELECT backtestOnline FROM backtestSettings;`,
  [backtestOnline], (err, row) => {
    if(err) {
      console.warn(new Date(), err);
      // If the MySQL query returned an error, pass the error message onto the client.
      res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
    } else {
      // Valid and successful request.
      res.send(row[0]);
    }
 });
})

// Listen for PUT requests to /backtest_settings/strategy to set the strategy that is in use in the backtest.
app.put('/backtest_settings/strategy', (req, res) => {
  // Extract data from request body.
  const { strategyId } = req.body;
  
  // Query constructor to update the chosen strategy.
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

// Listen for POST requests to /trades/? to add a new trade to the open_trades table under the given backtest.
app.post('/trades/:backtestId', (req, res) => {

  const backtestId = parseInt(req.params.backtestId);

  const { ticker, buy_date: buyDate, share_qty: shareQty, investment_total: investmentTotal, buy_price: buyPrice, 
    current_price: currentPrice, take_profit: takeProfit, stop_loss: stopLoss, profit_loss_pct: profitLossPct } = req.body;
  
  const figure = JSON.stringify(req.body.figure);
  const simpleFigure = JSON.stringify(req.body.simpleFigure);

  // Query constructor to send a new trade to openTrades.
	pool.query(`
    INSERT INTO openTrades
      (backtestId, ticker, buyDate, shareQty, investmentTotal, buyPrice, currentPrice, takeProfit, stopLoss, figure, simpleFigure, profitLossPct)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    SELECT LAST_INSERT_ID() AS trade_id;`, 
  [backtestId, ticker, buyDate, shareQty, investmentTotal, buyPrice, currentPrice, takeProfit, stopLoss, figure, simpleFigure, profitLossPct], (err, row) => {
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

// Listen for GET requests to /trades/?/stats to get the current trade statistics of the backtest from the date specified.
app.get('/trades/:backtestId/stats', (req, res) => {
  const backtestId = parseInt(req.params.backtestId);
  const date = req.query.date;

  if(date === undefined) {
    // If the date was not defined in the request query params, pass the error message onto the client.
    res.status(400).send("Invalid query.");
  }

  var sqlParamArray = [];
  for (var i = 0; i < 8; i++) {
    sqlParamArray.push(backtestId);
    sqlParamArray.push(date);
  }
  sqlParamArray.push(backtestId);
	// Query constructor to get all current backtest stats.
	pool.query(`
    SELECT *
      FROM closedTrades
        WHERE profitLossPct = (SELECT MAX(profitLossPct) FROM closedTrades WHERE backtestId=? AND profitLoss > 0 AND sellDate >= ?);
    SELECT *
      FROM closedTrades
        WHERE profitLossPct = (SELECT MIN(profitLossPct) FROM closedTrades WHERE backtestId=? AND profitLoss < 0 AND sellDate >= ?);
    SELECT AVG(profitLossPct) AS avgProfitPct
      FROM closedTrades
        WHERE backtestId=? AND profitLossPct > 0 AND sellDate >= ?;
    SELECT AVG(profitLossPct) AS avgLossPct
      FROM closedTrades
        WHERE backtestId=? AND profitLossPct < 0 AND sellDate >= ?;
    SELECT AVG(profitLossPct) as avgProfitLossPct
      FROM closedTrades
        WHERE backtestId=? AND sellDate > ?;
    SELECT (SELECT COUNT(profitLoss) FROM closedTrades WHERE backtestId=? AND profitLoss > 0 AND sellDate >= ?)/
          (SELECT COUNT(profitLoss) FROM closedTrades WHERE backtestId=? AND profitLoss < 0 AND sellDate >= ?) AS profitFactor;
    SELECT (SELECT SUM(profitLoss) FROM closedTrades WHERE backtestId=? AND sellDate >= ?)/
          (SELECT COUNT(profitLoss) FROM closedTrades WHERE  backtestId=?) * 100 AS totalProfitLoss;`,
          sqlParamArray, (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
        // Format results into a usable object to be sent to the client.
        const highestProfitTrade = row[0][0];
        if(highestProfitTrade !== undefined){
          highestProfitTrade.simpleFigure = JSON.parse(JSON.parse(highestProfitTrade.simpleFigure));
          highestProfitTrade.figure = JSON.parse(JSON.parse(highestProfitTrade.figure));
        }
        const highestLossTrade = row[1][0];
        if(highestLossTrade !== undefined){
          highestLossTrade.simpleFigure = JSON.parse(JSON.parse(highestLossTrade.simpleFigure));
          highestLossTrade.figure = JSON.parse(JSON.parse(highestLossTrade.figure));
        }
				const data = {highestProfitTrade, highestLossTrade, avgProfitPct: row[2][0].avgProfitPct, avgLossPct: row[3][0].avgLossPct, 
          avgProfitLossPct: row[4][0].avgProfitLossPct, profitFactor: row[5][0].profitFactor, totalProfitLoss: row[6][0].totalProfitLoss};
				res.send(data);
			}
	});
})

// Listen for GET requests to /trades/? to get the current trades for the specified backtest.
app.get('/trades/:backtestId', (req, res) => {

  const backtestId = parseInt(req.params.backtestId);

	// Query constructor to get all current open and closed trades..
	pool.query(`
    SELECT * FROM openTrades WHERE backtestId = ?;
    SELECT * FROM (
      SELECT * FROM closedTrades WHERE backtestId = ? ORDER BY sellDate DESC LIMIT 10
    ) sub;`, [backtestId, backtestId], (err, row) => {
			if(err) {
				console.warn(new Date(), err);
				// If the MySQL query returned an error, pass the error message onto the client.
				res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
			} else {
				// Valid and successful request, return the formatted date within an object.
        data = [row[0], row[1]]
        // Separate and parse the two results for the UI to easily use.
        for(i=0; i<data[0].length; i++) {
          data[0][i].simpleFigure = JSON.parse(JSON.parse(data[0][i].simpleFigure))
          data[0][i].figure = JSON.parse(JSON.parse(data[0][i].figure))
        }
        for(i=0; i<data[1].length; i++) {
          data[1][i].simpleFigure = JSON.parse(JSON.parse(data[1][i].simpleFigure))
          data[1][i].figure = JSON.parse(JSON.parse(data[1][i].figure))
        }
				res.send(data);
			}
	});
})

// Listen for PUT requests to /trades/? to update all open trades and send the closed ones to the closed trades table.
app.put('/trades/:backtestId', (req, res) => {

  const backtestId = parseInt(req.params.backtestId);
  
  const openTrades = req.body.open_trades,
        closedTrades = req.body.closed_trades;
  
  
  let result = []

  // Generate MySQL query string and inputs, to allow the backtest to update all required trades in the openTrades table.
  openTrades.forEach(trade => {
    const {trade_id: tradeId, current_price: currentPrice, profit_loss_pct: profitLossPct} = trade;
    const simpleFigure = JSON.stringify(trade.simpleFigure);
    const figure = JSON.stringify(trade.figure);
    // Query constructor to update the open trades.
    pool.query("UPDATE openTrades SET currentPrice = ?, simpleFigure = ?, figure = ?, profitLossPct = ? WHERE tradeId = ?;",
    [currentPrice, simpleFigure, figure, profitLossPct, tradeId], (err, row) => {
        if(err) {
          console.warn(new Date(), err);
          // If the MySQL query returned an error, pass the error message onto the client.
          res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        } else {
          // Valid and successful request.
          result.push(row);
        }
    });
  });

  // Generate MySQL query string and inputs, to allow the backtest to add all required trades in the closedTrades table.
  closedTrades.forEach(trade => {
    const {trade_id: tradeId, ticker, buy_date: buyDate, sell_date: sellDate, share_qty: shareQty, investment_total: investmentTotal, profit_loss: profitLoss,
      buy_price: buyPrice, sell_price: sellPrice, take_profit: takeProfit, stop_loss: stopLoss, profit_loss_pct: profitLossPct} = trade;
    const figure = JSON.stringify(trade.figure);
    const simpleFigure = JSON.stringify(trade.simpleFigure);
    // Query constructor to update the open trades.
    pool.query(`
      LOCK TABLES
        openTrades write,
        closedTrades write;
      INSERT INTO closedTrades (tradeId, backtestId, ticker, buyDate, sellDate, shareQty, investmentTotal, profitLoss, buyPrice, 
        sellPrice, takeProfit, stopLoss, figure, simpleFigure, profitLossPct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      DELETE FROM openTrades WHERE tradeId = ?;
      UNLOCK TABLES;`, 
      [tradeId, backtestId, ticker, buyDate, sellDate, shareQty, investmentTotal, profitLoss, buyPrice, sellPrice, takeProfit, stopLoss, figure, simpleFigure, profitLossPct, tradeId], (err, row) => {
      if(err) {
        console.warn(new Date(), err);
        // If the MySQL query returned an error, pass the error message onto the client.
        res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
      } else {
        // Valid and successful request.
        result.push(row);
      }
    });
  });

  res.send(result);
  io.emit("tradesUpdated");
  io.emit("updateStats");
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
  function getStrategies() {
    return new Promise(function(resolve, reject) {
      // Query constructor to get the current saved strategies.
	    pool.query(`SELECT * FROM strategies;`, (err, row) => {
        if(err) {
          console.warn(new Date(), err);
          // If the MySQL query returned an error, pass the error message onto the client.
          res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        }
        data = row
        for(i=0; i<row.length; i++){
          data[i].technicalAnalysis = JSON.parse(data[i].technicalAnalysis);
        }
        resolve(data);
      });
    });
  }

  function getBacktests(strategyId) {
    return new Promise(function(resolve, reject) {
      // Query constructor to get the current saved strategies.
	    pool.query(`SELECT * FROM backtests WHERE strategyId = ? AND (datetimeFinished is not null OR active=1) ORDER BY datetimeStarted DESC LIMIT 10;`, [strategyId], (err, row) => {
        if(err) {
          console.warn(new Date(), err);
          // If the MySQL query returned an error, pass the error message onto the client.
          res.status(500).send({devErrorMsg: err.sqlMessage, clientErrorMsg: "Internal server error."});
        }
        data = row
        resolve(data);
      });
    });
  }

  getStrategies()
  .then(async function(strategies) {
    for (let i = 0; i < strategies.length; i++) {
      const backtests = await getBacktests(strategies[i].strategyId);
      let sumSuccessRate = 0;
      let sumReturns = 0;
      let numActive = 0;

      backtests.forEach((backtest) => {
        backtest.totalProfitLossGraph = JSON.parse(JSON.parse(backtest.totalProfitLossGraph))
        if(backtest.active === 1) {
          numActive += 1;
        } else {
          sumSuccessRate += backtest.successRate;
          sumReturns += backtest.totalProfitLossPct;
        }
      });
      let avgSuccessRate = "N/A";
      let avgReturns = "N/A";
      if(backtests.length > 0) {
        avgSuccessRate = Math.round((sumSuccessRate/(backtests.length - numActive))*10)/10;
        avgReturns = sumReturns/(backtests.length - numActive);
        strategies[i].active = (backtests[0].active === 1);
      }
      strategies[i].backtests = backtests;
      strategies[i].avgSuccess = avgSuccessRate;
      strategies[i].avgReturns = avgReturns;
    }

    res.send(strategies);
  })
  .catch((err) => setImmediate(() => { throw err; })); // Throw async to escape the promise chain
	
})

// Listen for POST requests to /strategies to add a new strategy to the database.
app.post('/strategies', (req, res) => {

  // Extract data from request body.
  let { strategyName, strategyData } = req.body;

  // Convert json object into json string that can be accepted by the database.
  strategyData = JSON.stringify(strategyData)

  // Query constructor to send a new strategy to the database.
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

// Listen for GET requests to /strategies/? to get information on a specific strategy.
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

// Listen for PUT requests to /strategies/? and update the specified strategy.
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

// Listen for DELETE requests to /strategies? and delete the specified entry in the table.
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