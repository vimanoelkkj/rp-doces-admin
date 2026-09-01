import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteProduct, listProducts, ProductApiError } from "./product.api";
import type { Product, ProductId } from "./product.types";
import { ProductCard } from "./ProductCard";
import { ProductDialog } from "./ProductDialog";
import styles from "./ProductsPage.module.css";

type Filter = "todos" | "ativos" | "esgotados" | "arquivados";

export function ProductsPage() {
  const [products,setProducts]=useState<Product[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null);
  const [editing,setEditing]=useState<Product|null|undefined>(null); const [menu,setMenu]=useState<ProductId|null>(null); const [query,setQuery]=useState(""); const [filter,setFilter]=useState<Filter>("todos");
  const reload=useCallback(async()=>{setLoading(true);setError(null);try{setProducts(await listProducts());}catch(err){setError(err instanceof ProductApiError?err.message:"Não foi possível carregar os produtos.");}finally{setLoading(false);}},[]);
  useEffect(()=>{void reload();},[reload]);
  const visible=useMemo(()=>products.filter(p=>{const available=Math.max(0,p.estoque-p.estoque_reservado); const matches=!query||`${p.nome} ${p.descricao} ${p.categoria_nome||p.categoria}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")); if(!matches)return false; if(filter==="ativos")return p.ativo; if(filter==="arquivados")return !p.ativo; if(filter==="esgotados")return available<=0; return true;}),[products,query,filter]);
  async function archive(id:ProductId){setMenu(null);try{await deleteProduct(id);await reload();}catch(err){setError(err instanceof ProductApiError?err.message:"Não foi possível arquivar o produto.");}}
  return <main className={styles.page}>
    <header className={styles.top}><div><small>R&P Doces · Admin V2</small><h1>Produtos</h1><p>Primeiro módulo da nova base React + TypeScript.</p></div><button onClick={()=>setEditing(undefined)}>+ Novo produto</button></header>
    <section className={styles.toolbar}><input type="search" placeholder="Buscar produto" value={query} onChange={e=>setQuery(e.target.value)} /> <div>{(["todos","ativos","esgotados","arquivados"] as Filter[]).map(f=><button key={f} className={filter===f?styles.active:""} onClick={()=>setFilter(f)}>{f[0].toUpperCase()+f.slice(1)}</button>)}</div></section>
    <p className={styles.summary}>{loading?"Carregando catálogo…":`${visible.length} de ${products.length} produto(s)`}</p>
    {error&&<div className={styles.error} role="alert">{error}<button onClick={()=>void reload()}>Tentar novamente</button></div>}
    <section className={styles.grid}>{visible.map(product=><ProductCard key={product.id} product={product} menuOpen={menu===product.id} onToggleMenu={()=>setMenu(current=>current===product.id?null:product.id)} onEdit={()=>{setMenu(null);setEditing(product);}} onArchive={()=>void archive(product.id)} />)}</section>
    {!loading&&!error&&visible.length===0&&<p className={styles.empty}>Nenhum produto encontrado.</p>}
    {editing!==null&&<ProductDialog product={editing??null} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await reload();}} />}
  </main>;
}
