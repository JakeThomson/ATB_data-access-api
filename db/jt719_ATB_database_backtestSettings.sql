create table backtestSettings
(
    startDate      datetime       null,
    endDate        datetime       null,
    startBalance   decimal(16, 8) null,
    strategyId     int            null,
    marketIndex    varchar(20)    null,
    capPct         float          null,
    takeProfit     float          null,
    stopLoss       float          null,
    backtestOnline tinyint(1)     null,
    isPaused       tinyint(1)     null,
    constraint fk_strategyId
        foreign key (strategyId) references strategies (strategyId)
            on delete set null
)
    engine = InnoDB;

INSERT INTO backtestSettings (startDate, endDate, startBalance, strategyId, marketIndex, capPct, takeProfit, stopLoss, backtestOnline, isPaused) VALUES ('2015-01-14 00:00:00', '2015-02-14 00:00:00', 25000.00000000, 70, 's&p500', 0.4, 1.02, 0.99, 0, 0);