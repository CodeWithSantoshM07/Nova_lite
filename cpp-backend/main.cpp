// Banking & ATM Management System - C++ (Crow) REST backend + MySQL
#include "crow.h"
#include <mysql_driver.h>
#include <mysql_connection.h>
#include <cppconn/prepared_statement.h>
#include <cppconn/resultset.h>
#include <cppconn/resultset_metadata.h>
#include <cppconn/exception.h>
#include <mutex>
#include <map>
#include <random>
#include <cmath>
#include <functional>
using namespace std;
using J=crow::json::wvalue; using B=crow::json::rvalue; using Rows=vector<vector<string>>;
unique_ptr<sql::Connection> db; mutex mu; map<string,pair<int,string>> sess; // token -> (user id, role)
string env(const char*k,const char*d){const char*v=getenv(k);return v?v:d;}
Rows Q(const string&s,vector<string> a={}){unique_ptr<sql::PreparedStatement> p(db->prepareStatement(s));int i=1;for(auto&x:a)p->setString(i++,x);
 unique_ptr<sql::ResultSet> r(p->executeQuery());int n=r->getMetaData()->getColumnCount();Rows o;
 while(r->next()){vector<string> w;for(int c=1;c<=n;c++)w.push_back(r->isNull(c)?"":r->getString(c).asStdString());o.push_back(w);}return o;}
void X(const string&s,vector<string> a={}){unique_ptr<sql::PreparedStatement> p(db->prepareStatement(s));int i=1;for(auto&x:a)p->setString(i++,x);p->executeUpdate();}
void tx(function<void()> f){db->setAutoCommit(false);try{f();db->commit();}catch(...){db->rollback();db->setAutoCommit(true);throw;}db->setAutoCommit(true);}
crow::response js(const J&v,int c=200){crow::response r(c,v.dump());r.add_header("Content-Type","application/json");return r;}
crow::response err(const string&m,int c=400){J j;j["error"]=m;return js(j,c);}
crow::response rows(const Rows&r,vector<string> k){if(r.empty()){crow::response x(200,"[]");x.add_header("Content-Type","application/json");return x;}
 J o;for(size_t i=0;i<r.size();i++)for(size_t j=0;j<k.size();j++)o[i][k[j]]=r[i][j];return js(o);}
string S(const B&b,const char*k){return b&&b.has(k)?string(b[k].s()):"";}
double amt(const string&s){double d=0;try{d=stod(s);}catch(...){}if(d<=0||d>1e8)throw runtime_error("Enter a valid amount");return d;}
string myAcc(int u){auto r=Q("SELECT id FROM accounts WHERE user_id=?",{to_string(u)});if(r.empty())throw runtime_error("No account found");return r[0][0];}
// Core banking rule: move money on an account inside a DB transaction, log it, return new balance
string apply(const string&acc,double d,const string&type,const string&note){
 auto r=Q("SELECT status FROM accounts WHERE id=? FOR UPDATE",{acc});
 if(r.empty())throw runtime_error("Account not found");
 if(r[0][0]=="frozen")throw runtime_error("Account is frozen");
 X("UPDATE accounts SET balance=balance+? WHERE id=?",{to_string(d),acc});
 string nb=Q("SELECT balance FROM accounts WHERE id=?",{acc})[0][0];
 if(stod(nb)<0)throw runtime_error("Insufficient balance");
 X("INSERT INTO transactions(account_id,type,amount,balance_after,note) VALUES(?,?,?,?,?)",{acc,type,to_string(fabs(d)),nb,note});return nb;}
template<class F> void add(crow::SimpleApp&app,const char*path,crow::HTTPMethod m,string need,F f){
 app.route_dynamic(path).methods(m)([f,need](const crow::request&q)->crow::response{
  lock_guard<mutex> g(mu);
  try{int uid=0;
   if(need!=""){string h=q.get_header_value("Authorization");auto it=sess.find(h.size()>7?h.substr(7):"");
    if(it==sess.end())return err("Please log in",401);
    if(need=="admin"&&it->second.second!="admin")return err("Admin only",403);
    uid=it->second.first;}
   return f(uid,crow::json::load(q.body));
  }catch(sql::SQLException&e){return err(string("Database error: ")+e.what(),500);}
  catch(exception&e){return err(e.what());}});}
int main(){
 db.reset(sql::mysql::get_mysql_driver_instance()->connect(env("DB_HOST","tcp://127.0.0.1:3306"),env("DB_USER","root"),env("DB_PASS","")));
 db->setSchema(env("DB_NAME","bank_db"));
 crow::SimpleApp app;auto Post=crow::HTTPMethod::Post,Get=crow::HTTPMethod::Get;
 CROW_ROUTE(app,"/")([]{crow::response r;r.set_static_file_info_unsafe(string(FRONTEND)+"/index.html");return r;});
 add(app,"/api/register",Post,"",[](int,const B&b){
  string n=S(b,"name"),e=S(b,"email"),p=S(b,"password"),pin=S(b,"pin");
  if(n.empty()||e.find('@')==string::npos||p.size()<6||pin.size()!=4||pin.find_first_not_of("0123456789")!=string::npos)return err("Enter name, valid email, 6+ char password and 4-digit PIN");
  if(!Q("SELECT id FROM users WHERE email=?",{e}).empty())return err("Email already registered");
  tx([&]{X("INSERT INTO users(name,email,password) VALUES(?,?,SHA2(CONCAT('bank$',?),256))",{n,e,p});
   string id=Q("SELECT LAST_INSERT_ID()")[0][0];
   X("INSERT INTO accounts(user_id,acc_no) VALUES(?,CONCAT('10',LPAD(?,8,'0')))",{id,id});
   X("INSERT INTO atm_cards(account_id,card_no,pin) VALUES(LAST_INSERT_ID(),CONCAT('4000',LPAD(?,12,'0')),SHA2(CONCAT('bank$',?),256))",{id,pin});});
  J j;j["ok"]=true;return js(j);});
 add(app,"/api/login",Post,"",[](int,const B&b){
  auto r=Q("SELECT id,name,role FROM users WHERE email=? AND password=SHA2(CONCAT('bank$',?),256)",{S(b,"email"),S(b,"password")});
  if(r.empty())return err("Invalid email or password",401);
  static random_device rd;char t[33];snprintf(t,33,"%08x%08x%08x%08x",rd(),rd(),rd(),rd());
  sess[t]={stoi(r[0][0]),r[0][2]};X("INSERT INTO audit_log(user_id,action) VALUES(?,'login')",{r[0][0]});
  J j;j["token"]=string(t);j["name"]=r[0][1];j["role"]=r[0][2];return js(j);});
 add(app,"/api/summary",Get,"user",[](int u,const B&){return rows(Q("SELECT a.acc_no,a.type,a.balance,a.status,c.card_no,u.name FROM accounts a JOIN users u ON u.id=a.user_id LEFT JOIN atm_cards c ON c.account_id=a.id WHERE a.user_id=?",{to_string(u)}),{"acc_no","type","balance","status","card_no","name"});});
 auto money=[](int sign,const char*type,const char*note){return [=](int u,const B&b){double a=amt(S(b,"amount"));string nb;tx([&]{nb=apply(myAcc(u),sign*a,type,note);});J j;j["balance"]=nb;return js(j);};};
 add(app,"/api/deposit",Post,"user",money(1,"deposit","Cash deposit"));
 add(app,"/api/withdraw",Post,"user",money(-1,"withdraw","Online withdrawal"));
 add(app,"/api/transfer",Post,"user",[](int u,const B&b){double a=amt(S(b,"amount"));auto t=Q("SELECT id,acc_no FROM accounts WHERE acc_no=?",{S(b,"to_acc")});
  if(t.empty())return err("Recipient account not found");string me=myAcc(u);if(t[0][0]==me)return err("Cannot transfer to your own account");
  string my=Q("SELECT acc_no FROM accounts WHERE id=?",{me})[0][0],nb;
  tx([&]{nb=apply(me,-a,"transfer_out","To "+t[0][1]);apply(t[0][0],a,"transfer_in","From "+my);});
  J j;j["balance"]=nb;return js(j);});
 add(app,"/api/transactions",Get,"user",[](int u,const B&){return rows(Q("SELECT created_at,type,amount,balance_after,note FROM transactions WHERE account_id=? ORDER BY id DESC LIMIT 50",{myAcc(u)}),{"date","type","amount","balance","note"});});
 // ATM: card + PIN, 3 attempts then lock, daily limit, ATM cash check
 add(app,"/api/atm/withdraw",Post,"",[](int,const B&b){double a=amt(S(b,"amount"));
  auto c=Q("SELECT id,account_id,locked,daily_limit,pin=SHA2(CONCAT('bank$',?),256),attempts FROM atm_cards WHERE card_no=?",{S(b,"pin"),S(b,"card_no")});
  if(c.empty())return err("Card not found");
  if(c[0][2]=="1")return err("Card is locked. Contact the bank.");
  if(c[0][4]!="1"){X("UPDATE atm_cards SET attempts=attempts+1,locked=(attempts>=3) WHERE id=?",{c[0][0]});return err("Wrong PIN. Attempts left: "+to_string(2-stoi(c[0][5])));}
  X("UPDATE atm_cards SET attempts=0 WHERE id=?",{c[0][0]});
  double used=stod(Q("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND type='atm' AND DATE(created_at)=CURDATE()",{c[0][1]})[0][0]);
  if(used+a>stod(c[0][3]))return err("Daily ATM limit exceeded");
  if(a>stod(Q("SELECT cash FROM atm_cash WHERE id=1")[0][0]))return err("ATM has insufficient cash");
  string nb;tx([&]{nb=apply(c[0][1],-a,"atm","ATM withdrawal");X("UPDATE atm_cash SET cash=cash-? WHERE id=1",{to_string(a)});});
  J j;j["balance"]=nb;return js(j);});
 add(app,"/api/admin/stats",Get,"admin",[](int,const B&){J j;auto g=[](const char*s){return Q(s)[0][0];};
  j["customers"]=g("SELECT COUNT(*) FROM users WHERE role='customer'");j["total_balance"]=g("SELECT COALESCE(SUM(balance),0) FROM accounts");
  j["today"]=g("SELECT COUNT(*) FROM transactions WHERE DATE(created_at)=CURDATE()");j["atm_cash"]=g("SELECT cash FROM atm_cash WHERE id=1");
  auto t=Q("SELECT type,COUNT(*) FROM transactions GROUP BY type");for(size_t i=0;i<t.size();i++){j["by_type"][i]["type"]=t[i][0];j["by_type"][i]["count"]=t[i][1];}return js(j);});
 add(app,"/api/admin/customers",Get,"admin",[](int,const B&){return rows(Q("SELECT a.id,u.name,u.email,a.acc_no,a.balance,a.status FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.role='customer' ORDER BY a.id DESC"),{"id","name","email","acc_no","balance","status"});});
 add(app,"/api/admin/status",Post,"admin",[](int u,const B&b){string s=S(b,"status");if(s!="active"&&s!="frozen")return err("Bad status");
  X("UPDATE accounts SET status=? WHERE id=?",{s,S(b,"id")});X("INSERT INTO audit_log(user_id,action) VALUES(?,?)",{to_string(u),"account "+S(b,"id")+" set "+s});J j;j["ok"]=true;return js(j);});
 add(app,"/api/admin/refill",Post,"admin",[](int,const B&b){X("UPDATE atm_cash SET cash=cash+? WHERE id=1",{to_string(amt(S(b,"amount")))});J j;j["ok"]=true;return js(j);});
 add(app,"/api/admin/transactions",Get,"admin",[](int,const B&){return rows(Q("SELECT t.created_at,u.name,t.type,t.amount,t.note FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN users u ON u.id=a.user_id ORDER BY t.id DESC LIMIT 30"),{"date","name","type","amount","note"});});
 app.port(8080).multithreaded().run();}
