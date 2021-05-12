create table backtests
(
    backtestId           int auto_increment,
    strategyId           int            not null,
    datetimeStarted      datetime       null,
    datetimeFinished     datetime       null,
    backtestDate         datetime       null,
    totalBalance         decimal(16, 8) null,
    availableBalance     decimal(16, 8) null,
    totalProfitLoss      decimal(16, 8) null,
    totalProfitLossPct   decimal(5, 2)  null,
    totalProfitLossGraph json           null,
    successRate          float          null,
    active               tinyint(1)     null,
    constraint backtests_backtestId_uindex
        unique (backtestId),
    constraint fk_backtests_strategyId
        foreign key (strategyId) references strategies (strategyId)
            on delete cascade
)
    engine = InnoDB;

alter table backtests
    add primary key (backtestId);
