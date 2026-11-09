const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateBrokerPartialWeights:validate}=require('../broker-partial-validation');
test('accepts positive weights within two decimal precision including binary float artifacts',()=>{
 for(const berat of [1,0.01,3.43,2.72,'10.20',0.1+0.2]) validate({brokerPartial:[{berat}]});
});
test('rejects fractional thousandths and invalid quantities on both payload aliases',()=>{
 for(const key of ['brokerPartial','brokerPartialNew'])
 for(const berat of [0,-1,0.005,3.435,'1.001',null,'',Infinity,NaN,true])
 assert.throws(()=>validate({[key]:[{berat}]}));
});
test('does not change other material precision',()=>{
 validate({bbPartial:[{berat:1.001}]});validate({});
});
