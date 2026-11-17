export default function ConnectionStatus({state}){return <p className={`state ${state||'DISCONNECTED'}`}>Native checker: {state||'DISCONNECTED'}</p>}
