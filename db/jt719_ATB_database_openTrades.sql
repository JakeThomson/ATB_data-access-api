create table openTrades
(
    tradeId         int(15) auto_increment,
    backtestId      int(15)        not null,
    ticker          varchar(6)     null,
    buyDate         datetime       null,
    shareQty        int            null,
    investmentTotal decimal(16, 8) null,
    buyPrice        decimal(16, 8) null,
    currentPrice    decimal(16, 8) null,
    takeProfit      decimal(16, 8) null,
    stopLoss        decimal(16, 8) null,
    figure          json           null,
    simpleFigure    json           null,
    profitLossPct   float          null,
    constraint openTrades_tradeId_uindex
        unique (tradeId),
    constraint fk_openTrades_backtestId
        foreign key (backtestId) references backtests (backtestId)
            on delete cascade
)
    engine = InnoDB;

alter table openTrades
    add primary key (tradeId);