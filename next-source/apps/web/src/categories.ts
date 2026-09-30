const alipay:Record<string,string>={餐饮美食:'餐饮',食品酒水:'餐饮',服饰装扮:'购物',日用百货:'生活',家居家装:'生活',数码电器:'购物',运动户外:'购物',美容美发:'生活',母婴亲子:'生活',宠物:'生活',交通出行:'交通',爱车养车:'交通',住房物业:'生活',生活服务:'生活',医疗健康:'医疗',教育培训:'学习',文化休闲:'娱乐',游戏:'娱乐',旅行度假:'娱乐',商业服务:'其他',其他消费:'其他'};
export function sourceCategory(platform:string,source:string,name:string,product:string){
 if(platform==='支付宝'&&source)return alipay[source]||source;
 const text=name+' '+product;
 if(/美团|饿了么|盒马|餐厅|饭店|咖啡|奶茶|食堂|外卖/.test(text))return '餐饮';
 if(/地铁|公交|滴滴|铁路|高铁|打车/.test(text))return '交通';
 if(/医院|药房|药店|诊所/.test(text))return '医疗';
 if(/书店|教材|学费/.test(text))return '学习';
 return '其他';
}
