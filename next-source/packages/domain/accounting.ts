/** All monetary values are CNY fen. A null account means unresolved, not external. */
export type AccountRef = string | null;
export type Status = 'SUCCESS' | 'PENDING' | 'FAILED';
export type SourceEvidence = { id:string; sourceType:'MANUAL'|'SCREENSHOT'|'EXCEL'; platform:string; rawPayload:string };
export type EventBase = {
 id:string; occurredAt:string; name:string; note?:string;
 status?:Status; source?:SourceEvidence;
};
export type CreateAccount = { kind:'CREATE_ACCOUNT'; id:string; name:string; accountType:'ASSET'|'LIABILITY';
 openingBalance:number|null; openingBalanceAt:string; tracking?:boolean; last4?:string };
export type Purchase = EventBase & {kind:'PURCHASE';amount:number; payer:AccountRef; categoryId?:string;
 funding?:'OWN'|'EXTERNAL_SPONSOR'};
export type Income = EventBase & {kind:'INCOME';amount:number; destination:AccountRef};
export type InternalTransfer = EventBase & {kind:'INTERNAL_TRANSFER';amount:number;from:AccountRef;to:AccountRef};
export type Withdrawal = EventBase & {kind:'WITHDRAWAL';amount:number;fee:number;from:AccountRef;to:AccountRef};
export type ExternalPayment = EventBase & {kind:'EXTERNAL_TRANSFER'|'DEPOSIT'|'RED_PACKET';amount:number;
 from:AccountRef; consumptionAmount?:number; categoryId?:string};
export type Repayment = EventBase & {kind:'REPAYMENT';amount:number;from:string;to:string};
export type Refund = EventBase & {kind:'REFUND'|'RETURN';amount:number;originalId:string;destination:AccountRef;
 consumptionReduction?:number};
export type Meaning = {kind:'SET_CONSUMPTION';transactionId:string;amount:number;categoryId:string|null};
export type DeleteTransaction = {kind:'DELETE_TRANSACTION';transactionId:string;deletedAt:string};
export type FinancialEvent = Purchase|Income|InternalTransfer|Withdrawal|ExternalPayment|Repayment|Refund;
export type SetStatus = {kind:'SET_STATUS';transactionId:string;status:'SUCCESS'|'FAILED';settlement?:FinancialEvent};
export type BindAccount = ({kind:'BIND_ACCOUNT'}|{kind:'RESOLVE_ACCOUNT_BINDING'}) & {movementId:string;accountId:string};
export type ResolveSettlement = {kind:'RESOLVE_SETTLEMENT';transactionId:string;status:'SUCCESS'|'FAILED';settlement?:FinancialEvent;expectedOperationIds:string[]};
export type CorrectAmount = {kind:'CORRECT_AMOUNT';transactionId:string;amount:number;expectedAmount:number;reason:string;correctedAt:string;sourceId:string};
export type BusinessCommand = CorrectAmount| ResolveSettlement| SetStatus|BindAccount| DeleteTransaction| CreateAccount|Purchase|Income|InternalTransfer|Withdrawal|ExternalPayment|Repayment|Refund|Meaning;
