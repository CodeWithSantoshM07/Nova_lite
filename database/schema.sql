CREATE DATABASE IF NOT EXISTS bank_db; USE bank_db;
CREATE TABLE users(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(80),email VARCHAR(100) UNIQUE,password CHAR(64),role ENUM('customer','admin') DEFAULT 'customer',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE accounts(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,acc_no VARCHAR(16) UNIQUE,type ENUM('savings','current') DEFAULT 'savings',balance DECIMAL(14,2) DEFAULT 0,status ENUM('active','frozen') DEFAULT 'active',FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE transactions(id INT AUTO_INCREMENT PRIMARY KEY,account_id INT,type ENUM('deposit','withdraw','transfer_in','transfer_out','atm'),amount DECIMAL(14,2),balance_after DECIMAL(14,2),note VARCHAR(100),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(account_id) REFERENCES accounts(id));
CREATE TABLE atm_cards(id INT AUTO_INCREMENT PRIMARY KEY,account_id INT,card_no VARCHAR(16) UNIQUE,pin CHAR(64),attempts INT DEFAULT 0,locked TINYINT DEFAULT 0,daily_limit DECIMAL(10,2) DEFAULT 20000,FOREIGN KEY(account_id) REFERENCES accounts(id));
CREATE TABLE atm_cash(id INT PRIMARY KEY,cash DECIMAL(14,2));
CREATE TABLE audit_log(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,action VARCHAR(100),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

-- Extra tables (beneficiaries, loans) and sample data are created by seed.js on first start.
