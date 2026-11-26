// Demo/sample data generator + extra tables. Runs on first start and from Admin > "Reset demo data".
const DDL=[`CREATE TABLE IF NOT EXISTS beneficiaries(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,name VARCHAR(80),acc_no VARCHAR(16),FOREIGN KEY(user_id) REFERENCES users(id))`,
`ALTER TABLE transactions MODIFY type ENUM('deposit','withdraw','transfer_in','transfer_out','atm','bill','cashback')`,
`CREATE TABLE IF NOT EXISTS pay_requests(id INT AUTO_INCREMENT PRIMARY KEY,from_user INT,to_user INT,amount DECIMAL(12,2),note VARCHAR(80),status ENUM('pending','paid','declined') DEFAULT 'pending',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(from_user) REFERENCES users(id),FOREIGN KEY(to_user) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS loans(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,amount DECIMAL(12,2),months INT,rate DECIMAL(4,2) DEFAULT 10.5,purpose VARCHAR(60),status ENUM('pending','approved','rejected') DEFAULT 'pending',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id))`];
const BILLS=[['Mobile recharge','Jio'],['Mobile recharge','Airtel'],['Electricity','TNEB'],['DTH','Tata Play'],['Broadband','ACT Fibernet'],['Water','Metro Water']];
const NAMES=['Demo Customer','Priya Sharma','Arun Kumar','Meera Nair','Rahul Verma','Sneha Iyer','Karthik Raj','Divya Menon','Vikram Singh','Ananya Das','Mohammed Faisal','Lakshmi Narayanan'];
async function seedDemo(pool){let s=7;const rnd=()=>(s=(s*16807)%2147483647)/2147483647,ri=(a,b)=>Math.floor(a+rnd()*(b-a+1));
 const c=await pool.getConnection();
 try{await c.query('SET FOREIGN_KEY_CHECKS=0');for(const t of ['audit_log','pay_requests','loans','beneficiaries','transactions','atm_cards','atm_cash','accounts','users'])await c.query('TRUNCATE '+t);await c.query('SET FOREIGN_KEY_CHECKS=1');
  const H="SHA2(CONCAT('bank$',?),256)",n=NAMES.length,bal=Array(n).fill(0);
  await c.query(`INSERT INTO users(name,email,password,role) VALUES('Bank Admin','admin@bank.com',${H},'admin')`,['Admin@123']);
  for(let i=0;i<n;i++){const id=i+2,e=i?NAMES[i].split(' ')[0].toLowerCase()+'@mail.com':'demo@bank.com';
   await c.query(`INSERT INTO users(name,email,password) VALUES(?,?,${H})`,[NAMES[i],e,'Demo@123']);
   await c.query("INSERT INTO accounts(user_id,acc_no,type,status) VALUES(?,CONCAT('10',LPAD(?,8,'0')),?,?)",[id,id,i%4==3?'current':'savings',i==9?'frozen':'active']);
   await c.query(`INSERT INTO atm_cards(account_id,card_no,pin,locked) VALUES(?,CONCAT('4000',LPAD(?,12,'0')),${H},?)`,[i+1,id,'1234',i==6?1:0])}
  const log=(a,type,amount,note,d)=>c.query('INSERT INTO transactions(account_id,type,amount,balance_after,note,created_at) VALUES(?,?,?,?,?,DATE_SUB(NOW(),INTERVAL ? MINUTE))',[a+1,type,amount,bal[a],note,d*1440+(d?ri(0,1100):ri(0,40))]);
  const acc=i=>'10'+String(i+2).padStart(8,'0');
  for(let d=30;d>=0;d--)for(let a=0;a<n;a++){
   if(d==30){bal[a]=ri(30,150)*1000;await log(a,'deposit',bal[a],'Opening balance',d);continue}
   if(rnd()>(a==0?.85:.45))continue;const k=ri(0,9),m=ri(5,150)*100,bl=ri(1,30)*100;
   if(k<3){bal[a]+=m*3;await log(a,'deposit',m*3,'Cash deposit',d)}
   else if(k<4&&m<bal[a]){bal[a]-=m;await log(a,'withdraw',m,'Online withdrawal',d)}
   else if(k<5&&d&&m<bal[a]&&m<=10000){bal[a]-=m;await log(a,'atm',m,'ATM withdrawal',d)}
   else if(k<7&&m<bal[a]){const t=(a+ri(1,n-1))%n;bal[a]-=m;await log(a,'transfer_out',m,'UPI to '+NAMES[t],d);bal[t]+=m;await log(t,'transfer_in',m,'UPI from '+NAMES[a],d)}
   else if(bl<bal[a]){const[cat,prov]=BILLS[ri(0,BILLS.length-1)];bal[a]-=bl;await log(a,'bill',bl,`${cat} · ${prov} · `+ri(7000000000,9999999999),d);const cb=Math.min(50,Math.round(bl/100));if(cb>=1){bal[a]+=cb;await log(a,'cashback',cb,'Cashback on '+cat,d)}}}
  for(let a=0;a<n;a++)await c.query('UPDATE accounts SET balance=? WHERE id=?',[bal[a],a+1]);
  await c.query('INSERT INTO atm_cash VALUES(1,450000)');
  for(const[u,m,l,st,p]of[[2,200000,36,'pending','Home renovation'],[2,50000,12,'approved','Education'],[3,500000,60,'pending','Vehicle'],[4,100000,24,'rejected','Business'],[6,300000,48,'approved','Home'],[8,75000,18,'pending','Medical']])
   await c.query('INSERT INTO loans(user_id,amount,months,purpose,status) VALUES(?,?,?,?,?)',[u,m,l,p,st]);
  for(const[f,t,a,nt,st]of[[3,2,1200,'Dinner split','pending'],[4,2,500,'Movie tickets','pending'],[2,5,800,'Cab fare','pending'],[6,2,300,'Lunch','paid']])await c.query('INSERT INTO pay_requests(from_user,to_user,amount,note,status) VALUES(?,?,?,?,?)',[f,t,a,nt,st]);
  for(const[nm,i]of[['Priya Sharma',1],['Arun Kumar',2],['Meera Nair',3]])await c.query('INSERT INTO beneficiaries(user_id,name,acc_no) VALUES(2,?,?)',[nm,acc(i)]);
  for(const[u,a]of[[2,'login'],[1,'login'],[3,'login'],[1,'account 10 set frozen'],[1,'loan 2 approved'],[4,'login'],[1,'loan 4 rejected'],[5,'login'],[1,'login']])
   await c.query('INSERT INTO audit_log(user_id,action,created_at) VALUES(?,?,DATE_SUB(NOW(),INTERVAL ? MINUTE))',[u,a,ri(10,3000)]);
 }finally{await c.query('SET FOREIGN_KEY_CHECKS=1').catch(()=>{});c.release()}}
module.exports={DDL,seedDemo};
