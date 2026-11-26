// NovaBank backend (Node.js + MySQL). Same REST API as cpp-backend/main.cpp, so the frontend works with either.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),mysql=require('mysql2/promise');
const CFG={host:process.env.DB_HOST||'127.0.0.1',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASS||''};
const{DDL,seedDemo}=require('./seed');const sess=new Map();let pool;
class E extends Error{constructor(m,c){super(m);this.c=c||400}}
const amt=s=>{const d=parseFloat(s);if(!(d>0)||d>1e8)throw new E('Enter a valid amount');return d};
async function init(){const c=await mysql.createConnection({...CFG,multipleStatements:true});
 const[d]=await c.query("SHOW DATABASES LIKE 'bank_db'");
 if(!d.length){await c.query(fs.readFileSync(path.join(__dirname,'database','schema.sql'),'utf8'));console.log('Database bank_db created with demo data')}
 await c.end();pool=mysql.createPool({...CFG,database:'bank_db',connectionLimit:8,dateStrings:true});for(const q of DDL)await pool.query(q);
 if((await pool.query('SELECT COUNT(*) n FROM users'))[0][0].n<5){await seedDemo(pool);console.log('Sample data loaded')}}
async function tx(fn){const c=await pool.getConnection();try{await c.beginTransaction();const r=await fn(c);await c.commit();return r}catch(e){await c.rollback();throw e}finally{c.release()}}
const myAcc=async uid=>{const[r]=await pool.query('SELECT id FROM accounts WHERE user_id=?',[uid]);if(!r.length)throw new E('No account found');return r[0].id};
// core banking rule: move money inside a DB transaction, log it, return new balance
async function apply(c,acc,d,type,note){const[r]=await c.query('SELECT status FROM accounts WHERE id=? FOR UPDATE',[acc]);
 if(!r.length)throw new E('Account not found');if(r[0].status=='frozen')throw new E('Account is frozen');
 await c.query('UPDATE accounts SET balance=balance+? WHERE id=?',[d,acc]);
 const[[b]]=await c.query('SELECT balance FROM accounts WHERE id=?',[acc]);if(+b.balance<0)throw new E('Insufficient balance');
 await c.query('INSERT INTO transactions(account_id,type,amount,balance_after,note) VALUES(?,?,?,?,?)',[acc,type,Math.abs(d),b.balance,note]);return b.balance}
const money=(sign,type,note)=>async(u,b)=>{const a=amt(b.amount),acc=await myAcc(u);return{balance:await tx(c=>apply(c,acc,sign*a,type,note))}};
const R={
'POST /api/register':{fn:async(_,b)=>{const{name:n,email:e,password:p,pin}=b;
 if(!n||!e||!e.includes('@')||!p||p.length<6||!/^\d{4}$/.test(pin||''))throw new E('Enter name, valid email, 6+ char password and 4-digit PIN');
 if((await pool.query("SELECT id FROM users WHERE LOWER(SUBSTRING_INDEX(email,'@',1))=LOWER(?)",[e.split('@')[0]]))[0].length)throw new E('That email / UPI handle is already taken. Use a different email, or log in.');
 await tx(async c=>{const[u]=await c.query("INSERT INTO users(name,email,password) VALUES(?,?,SHA2(CONCAT('bank$',?),256))",[n,e,p]);const id=u.insertId;
  await c.query("INSERT INTO accounts(user_id,acc_no) VALUES(?,CONCAT('10',LPAD(?,8,'0')))",[id,id]);
  await c.query("INSERT INTO atm_cards(account_id,card_no,pin) VALUES(LAST_INSERT_ID(),CONCAT('4000',LPAD(?,12,'0')),SHA2(CONCAT('bank$',?),256))",[id,pin])});return{ok:true}}},
'POST /api/login':{fn:async(_,b)=>{const[r]=await pool.query("SELECT id,name,role FROM users WHERE email=? AND password=SHA2(CONCAT('bank$',?),256)",[b.email||'',b.password||'']);
 if(!r.length)throw new E('Invalid email or password',401);const t=crypto.randomBytes(16).toString('hex');sess.set(t,{id:r[0].id,role:r[0].role});
 await pool.query("INSERT INTO audit_log(user_id,action) VALUES(?,'login')",[r[0].id]);return{token:t,name:r[0].name,role:r[0].role}}},
'GET /api/summary':{need:1,fn:async u=>(await pool.query(`SELECT a.acc_no,a.type,a.balance,a.status,c.card_no,u.name,CONCAT(LOWER(SUBSTRING_INDEX(u.email,'@',1)),'@novabank') AS upi FROM accounts a JOIN users u ON u.id=a.user_id LEFT JOIN atm_cards c ON c.account_id=a.id WHERE a.user_id=?`,[u]))[0]},
'POST /api/deposit':{need:1,fn:money(1,'deposit','Cash deposit')},
'POST /api/withdraw':{need:1,fn:money(-1,'withdraw','Online withdrawal')},
'POST /api/transfer':{need:1,fn:async(u,b)=>{const a=amt(b.amount),[t]=await pool.query('SELECT id,acc_no FROM accounts WHERE acc_no=?',[b.to_acc||'']);
 if(!t.length)throw new E('Recipient account not found');const me=await myAcc(u);if(t[0].id==me)throw new E('Cannot transfer to your own account');
 const[[m]]=await pool.query('SELECT acc_no FROM accounts WHERE id=?',[me]);
 return{balance:await tx(async c=>{const nb=await apply(c,me,-a,'transfer_out','To '+t[0].acc_no);await apply(c,t[0].id,a,'transfer_in','From '+m.acc_no);return nb})}}},
'GET /api/transactions':{need:1,fn:async u=>(await pool.query('SELECT created_at AS date,type,amount,balance_after AS balance,note FROM transactions WHERE account_id=? ORDER BY id DESC LIMIT 50',[await myAcc(u)]))[0]},
// ATM: card + PIN, 3 attempts then lock, daily limit, ATM cash check
'POST /api/atm/withdraw':{fn:async(_,b)=>{const a=amt(b.amount),[c]=await pool.query("SELECT id,account_id,locked,daily_limit,pin=SHA2(CONCAT('bank$',?),256) AS ok,attempts FROM atm_cards WHERE card_no=?",[b.pin||'',b.card_no||'']);
 if(!c.length)throw new E('Card not found');const k=c[0];if(k.locked)throw new E('Card is locked. Contact the bank.');
 if(!k.ok){await pool.query('UPDATE atm_cards SET attempts=attempts+1,locked=(attempts>=3) WHERE id=?',[k.id]);throw new E('Wrong PIN. Attempts left: '+Math.max(0,2-k.attempts))}
 await pool.query('UPDATE atm_cards SET attempts=0 WHERE id=?',[k.id]);
 const[[u]]=await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id=? AND type='atm' AND DATE(created_at)=CURDATE()",[k.account_id]);
 if(+u.s+a>+k.daily_limit)throw new E('Daily ATM limit exceeded');
 const[[cash]]=await pool.query('SELECT cash FROM atm_cash WHERE id=1');if(a>+cash.cash)throw new E('ATM has insufficient cash');
 return{balance:await tx(async cn=>{const nb=await apply(cn,k.account_id,-a,'atm','ATM withdrawal');await cn.query('UPDATE atm_cash SET cash=cash-? WHERE id=1',[a]);return nb})}}},
'GET /api/admin/stats':{need:'admin',fn:async()=>{const g=async s=>Object.values((await pool.query(s))[0][0])[0];
 return{customers:await g("SELECT COUNT(*) FROM users WHERE role='customer'"),total_balance:await g('SELECT COALESCE(SUM(balance),0) FROM accounts'),today:await g('SELECT COUNT(*) FROM transactions WHERE DATE(created_at)=CURDATE()'),atm_cash:await g('SELECT cash FROM atm_cash WHERE id=1'),bills_total:await g("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='bill'"),cashback_total:await g("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='cashback'"),by_type:(await pool.query('SELECT type,COUNT(*) AS count FROM transactions GROUP BY type'))[0],daily:(await pool.query('SELECT DATE_FORMAT(created_at,"%d %b") d,COUNT(*) n,MIN(created_at) m FROM transactions WHERE created_at>=CURDATE()-INTERVAL 13 DAY GROUP BY d ORDER BY m'))[0]}}},
'GET /api/admin/customers':{need:'admin',fn:async()=>(await pool.query("SELECT a.id,u.name,u.email,a.acc_no,a.balance,a.status,c.locked FROM users u JOIN accounts a ON a.user_id=u.id LEFT JOIN atm_cards c ON c.account_id=a.id WHERE u.role='customer' ORDER BY a.id DESC"))[0]},
'POST /api/admin/status':{need:'admin',fn:async(u,b)=>{if(!['active','frozen'].includes(b.status))throw new E('Bad status');
 await pool.query('UPDATE accounts SET status=? WHERE id=?',[b.status,b.id]);await pool.query('INSERT INTO audit_log(user_id,action) VALUES(?,?)',[u,`account ${b.id} set ${b.status}`]);return{ok:true}}},
'POST /api/admin/refill':{need:'admin',fn:async(_,b)=>{await pool.query('UPDATE atm_cash SET cash=cash+? WHERE id=1',[amt(b.amount)]);return{ok:true}}},
'GET /api/admin/transactions':{need:'admin',fn:async()=>(await pool.query('SELECT t.created_at AS date,u.name,t.type,t.amount,t.note FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN users u ON u.id=a.user_id ORDER BY t.id DESC LIMIT 30'))[0]}};
Object.assign(R,{
'GET /api/beneficiaries':{need:1,fn:async u=>(await pool.query('SELECT id,name,acc_no FROM beneficiaries WHERE user_id=?',[u]))[0]},
'POST /api/beneficiaries':{need:1,fn:async(u,b)=>{if(!b.name)throw new E('Enter a payee name');const[t]=await pool.query('SELECT id FROM accounts WHERE acc_no=?',[b.acc_no||'']);if(!t.length)throw new E('No account with that number');await pool.query('INSERT INTO beneficiaries(user_id,name,acc_no) VALUES(?,?,?)',[u,b.name,b.acc_no]);return{ok:true}}},
'POST /api/beneficiaries/delete':{need:1,fn:async(u,b)=>{await pool.query('DELETE FROM beneficiaries WHERE id=? AND user_id=?',[b.id,u]);return{ok:true}}},
'GET /api/loans':{need:1,fn:async u=>(await pool.query('SELECT id,amount,months,rate,purpose,status,created_at AS date FROM loans WHERE user_id=? ORDER BY id DESC',[u]))[0]},
'POST /api/loans':{need:1,fn:async(u,b)=>{const a=amt(b.amount),m=parseInt(b.months);if(!(m>=3&&m<=84))throw new E('Tenure must be 3-84 months');if(a>1000000)throw new E('Maximum loan is ₹10,00,000');await pool.query('INSERT INTO loans(user_id,amount,months,purpose) VALUES(?,?,?,?)',[u,a,m,b.purpose||'Personal']);return{ok:true}}},
'POST /api/profile/password':{need:1,fn:async(u,b)=>{if(!b.new_password||b.new_password.length<6)throw new E('New password needs 6+ characters');const[r]=await pool.query("UPDATE users SET password=SHA2(CONCAT('bank$',?),256) WHERE id=? AND password=SHA2(CONCAT('bank$',?),256)",[b.new_password,u,b.old_password||'']);if(!r.affectedRows)throw new E('Current password is wrong');return{ok:true}}},
'POST /api/profile/pin':{need:1,fn:async(u,b)=>{if(!/^\d{4}$/.test(b.new_pin||''))throw new E('PIN must be 4 digits');const[r]=await pool.query("UPDATE atm_cards SET pin=SHA2(CONCAT('bank$',?),256) WHERE account_id=? AND pin=SHA2(CONCAT('bank$',?),256)",[b.new_pin,await myAcc(u),b.old_pin||'']);if(!r.affectedRows)throw new E('Current PIN is wrong');return{ok:true}}},
'GET /api/admin/loans':{need:'admin',fn:async()=>(await pool.query("SELECT l.id,u.name,l.amount,l.months,l.rate,l.purpose,l.status,l.created_at AS date FROM loans l JOIN users u ON u.id=l.user_id ORDER BY l.status='pending' DESC,l.id DESC"))[0]},
'POST /api/admin/loan':{need:'admin',fn:async(u,b)=>{if(!['approved','rejected'].includes(b.status))throw new E('Bad status');
 await tx(async c=>{const[[l]]=await c.query("SELECT user_id,amount FROM loans WHERE id=? AND status='pending' FOR UPDATE",[b.id]);if(!l)throw new E('Loan already decided');
  await c.query('UPDATE loans SET status=? WHERE id=?',[b.status,b.id]);
  if(b.status=='approved')await apply(c,(await c.query('SELECT id FROM accounts WHERE user_id=?',[l.user_id]))[0][0].id,+l.amount,'deposit','Loan disbursed');
  await c.query('INSERT INTO audit_log(user_id,action) VALUES(?,?)',[u,`loan ${b.id} ${b.status}`])});return{ok:true}}},
'GET /api/admin/audit':{need:'admin',fn:async()=>(await pool.query("SELECT l.created_at AS date,COALESCE(u.name,'system') AS name,l.action FROM audit_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 60"))[0]},
'POST /api/admin/unlock':{need:'admin',fn:async(u,b)=>{await pool.query('UPDATE atm_cards SET locked=0,attempts=0 WHERE account_id=?',[b.id]);await pool.query('INSERT INTO audit_log(user_id,action) VALUES(?,?)',[u,'card unlocked for account '+b.id]);return{ok:true}}},
'POST /api/admin/reset-demo':{need:'admin',fn:async()=>{await seedDemo(pool);return{ok:true}}}});
// ---- UPI-style payments, requests, bills & cashback ----
async function chkPin(u,pin){const k=(await pool.query("SELECT id,locked,attempts,pin=SHA2(CONCAT('bank$',?),256) AS ok FROM atm_cards WHERE account_id=?",[pin||'',await myAcc(u)]))[0][0];
 if(!k)throw new E('No card found');if(k.locked)throw new E('PIN locked. Contact the bank.');
 if(!k.ok){await pool.query('UPDATE atm_cards SET attempts=attempts+1,locked=(attempts>=3) WHERE id=?',[k.id]);throw new E('Wrong PIN. Attempts left: '+Math.max(0,2-k.attempts))}
 await pool.query('UPDATE atm_cards SET attempts=0 WHERE id=?',[k.id])}
const UPI="CONCAT(LOWER(SUBSTRING_INDEX(u.email,'@',1)),'@novabank')";
async function findPayee(to){const[t]=await pool.query(`SELECT a.id,a.acc_no,a.user_id,u.name,${UPI} AS upi FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.acc_no=? OR ${UPI}=?`,[to,to]);if(!t.length)throw new E('UPI ID / account not found');return t[0]}
const lastId=async c=>'NB'+(await c.query('SELECT MAX(id) i FROM transactions'))[0][0].i;
Object.assign(R,{
'POST /api/upi/pay':{need:1,fn:async(u,b)=>{const a=amt(b.amount);if(a>100000)throw new E('UPI limit is ₹1,00,000 per payment');await chkPin(u,b.pin);
 const t=await findPayee((b.to||'').trim().toLowerCase()),me=await myAcc(u);if(t.id==me)throw new E('You cannot pay yourself');
 const[[m]]=await pool.query('SELECT name FROM users WHERE id=?',[u]),n=b.note?' · '+b.note:'';
 return tx(async c=>{const nb=await apply(c,me,-a,'transfer_out','UPI to '+t.name+n);await apply(c,t.id,a,'transfer_in','UPI from '+m.name+n);return{balance:nb,ref:await lastId(c),to:t.name,upi:t.upi,amount:a}})}},
'POST /api/requests':{need:1,fn:async(u,b)=>{const a=amt(b.amount),t=await findPayee((b.to||'').trim().toLowerCase());if(t.user_id==u)throw new E('You cannot request money from yourself');
 await pool.query('INSERT INTO pay_requests(from_user,to_user,amount,note) VALUES(?,?,?,?)',[u,t.user_id,a,b.note||'']);return{ok:true}}},
'GET /api/requests':{need:1,fn:async u=>({incoming:(await pool.query('SELECT r.id,u.name,r.amount,r.note,r.status,r.created_at AS date FROM pay_requests r JOIN users u ON u.id=r.from_user WHERE r.to_user=? ORDER BY r.id DESC LIMIT 20',[u]))[0],
 outgoing:(await pool.query('SELECT r.id,u.name,r.amount,r.note,r.status,r.created_at AS date FROM pay_requests r JOIN users u ON u.id=r.to_user WHERE r.from_user=? ORDER BY r.id DESC LIMIT 20',[u]))[0]})},
'POST /api/requests/respond':{need:1,fn:async(u,b)=>{const[[r]]=await pool.query("SELECT id,from_user,amount FROM pay_requests WHERE id=? AND to_user=? AND status='pending'",[b.id,u]);if(!r)throw new E('Request not found or already handled');
 if(b.action=='decline'){await pool.query("UPDATE pay_requests SET status='declined' WHERE id=?",[r.id]);return{ok:true}}
 await chkPin(u,b.pin);const me=await myAcc(u),to=(await pool.query('SELECT id FROM accounts WHERE user_id=?',[r.from_user]))[0][0].id,[[m]]=await pool.query('SELECT name FROM users WHERE id=?',[u]),[[o]]=await pool.query('SELECT name FROM users WHERE id=?',[r.from_user]);
 return tx(async c=>{const nb=await apply(c,me,-r.amount,'transfer_out','UPI to '+o.name+' · request');await apply(c,to,+r.amount,'transfer_in','UPI from '+m.name+' · request');await c.query("UPDATE pay_requests SET status='paid' WHERE id=?",[r.id]);return{balance:nb,ref:await lastId(c)}})}},
'POST /api/bills':{need:1,fn:async(u,b)=>{const a=amt(b.amount);if(!b.ref)throw new E('Enter the mobile number / consumer ID');if(a>50000)throw new E('Bill limit is ₹50,000');await chkPin(u,b.pin);const me=await myAcc(u);
 return tx(async c=>{let nb=await apply(c,me,-a,'bill',`${b.category} · ${b.provider} · ${b.ref}`);const cb=a>=100?Math.min(50,Math.round(a)/100):0;if(cb>=1)nb=await apply(c,me,cb,'cashback','Cashback on '+b.category);return{balance:nb,cashback:cb,ref:await lastId(c)}})}},
'GET /api/admin/payments':{need:'admin',fn:async()=>(await pool.query("SELECT t.created_at AS date,u.name,t.type,t.amount,t.note FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN users u ON u.id=a.user_id WHERE t.type IN ('bill','cashback') OR t.note LIKE 'UPI%' ORDER BY t.id DESC LIMIT 50"))[0]}});
http.createServer(async(req,res)=>{const url=req.url.split('?')[0],send=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
 if(req.method=='GET'&&(url=='/'||url=='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'frontend','index.html')))}
 const r=R[req.method+' '+url];if(!r)return send(404,{error:'Not found'});let body='';for await(const ch of req)body+=ch;
 try{let uid=0;if(r.need){const s=sess.get((req.headers.authorization||'').slice(7));if(!s)return send(401,{error:'Please log in'});if(r.need=='admin'&&s.role!='admin')return send(403,{error:'Admin only'});uid=s.id}
  send(200,await r.fn(uid,body?JSON.parse(body):{}))}catch(e){send(e.c||(e.sqlMessage?500:400),{error:e.sqlMessage?'Database error: '+e.sqlMessage:e.message})}
}).listen(+(process.env.PORT||8080),async()=>{try{await init();console.log('NovaBank running at http://localhost:'+(process.env.PORT||8080))}catch(e){console.log('\nCANNOT CONNECT TO MYSQL: '+e.message+'\nCheck MySQL is running and DB_PASS in start.bat is your root password.');process.exit(1)}});
