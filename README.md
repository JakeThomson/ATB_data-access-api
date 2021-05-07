# Algorithmic Trading Backtesting System - Data Access API

This application is the backend code that runs the data access API within the Algorithmic Trading Backtesting System. The other components of the system can be found here:
- [Backtesting Platform](https://github.com/JakeThomson/ATB_back-end)
- [User Interface](https://github.com/JakeThomson/ATB_front-end)

The system was built entirely by me in 10 weeks for my final year project.
To find out more about this and other projects I've worked on, check out my website
[jake-t.codes](https://jake-t.codes)!

## Installation

_In order to run this application on your local, you will need to set up a MySQL databse instance for the server to connect to, using the table creation queries found in the db folder inside this project._

1. You will need Node.JS installed and working on your system to run this project, download the recommended version 
[here](https://nodejs.org/en/download/).
   
<span style="font-size:14pt;">**NOTE:**</span> To check that node has been installed on your system properly, type `npm -v` into a cmd/terminal window.

2. Clone git repository onto your machine.
```
git clone https://github.com/JakeThomson/ATB_data-access-api
```

3. Go to project directory in cmd/terminal.
```
cd \path\to\project_directory\
```

4. Install all required libraries to run the UI.
```
npm install
```

5. Create a MySQL database instance on the platform of your choice, and use the queries stored in the `db` folder in this project to create the required tables. 

6. Create a file in the project directory named `.env` and fill it with the following database credentials to the database you just created:
```
MYSQL_HOST=
MYSQL_USER=
MYSQL_PWD=
MYSQL_DB=
```


## Running the application

To run the UI on your local machine, navigate to the project directory in cmd/terminal and use the command
```
npm run start
```

You will then be able to access the API through the url https://localhost:8080

<span style="font-size:14pt;">**IMPORTANT:**</span> You will need to be running the [Backtesting Platform](https://github.com/JakeThomson/ATB_data-access-api) in local mode in order for it to communicate with the API running on your local.