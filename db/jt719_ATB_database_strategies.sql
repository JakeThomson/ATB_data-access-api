create table strategies
(
    strategyId         int auto_increment,
    strategyName       varchar(50) null,
    technicalAnalysis  json        null,
    lookbackRangeWeeks int         null,
    maxWeekPeriod      int         null,
    constraint strategyConfig_strategyId_uindex
        unique (strategyId)
)
    engine = InnoDB;

alter table strategies
    add primary key (strategyId);
