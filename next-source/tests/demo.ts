import {FakeSyncProvider} from '../packages/sync/index.ts';
import {device,seed,converge,patch} from './helpers.ts';
const remote=new FakeSyncProvider(),a=device('phone',remote),b=device('desktop',remote);
try {
 seed(a,b);a.service.execute([patch('consumption_effects','e','category_id','餐饮')]);b.service.execute([patch('transactions','t','note','双设备离线修改')]);converge(a,b);
 console.log(JSON.stringify({phone:{transaction:a.store.get('transactions','t'),effect:a.store.get('consumption_effects','e')},desktop:{transaction:b.store.get('transactions','t'),effect:b.store.get('consumption_effects','e')},conflicts:a.store.conflicts()},null,2));
}finally{a.store.close();b.store.close();}
