import type { Metadata } from "next";

export const metadata: Metadata = { title: "JOJO · varianty rozložení" };

const VARIANTS = [
  {
    href: "/lab/thread",
    name: "A · Vlákno",
    tag: "doporučeno",
    text: "Jeden sloupec uprostřed. Vše, i grafy a tabulky, se skládá do vlákna jako dokument, který se píše sám. Historie vlevo.",
  },
  {
    href: "/lab/inspector",
    name: "B · Vlákno + A2UI inspektor",
    tag: "na demo",
    text: "Vlákno a vpravo živý proud A2UI zpráv a data model. Ukazuje porotě, jak agenti skládají UI a že čísla jdou z dat.",
  },
  {
    href: "/lab/split",
    name: "C · Chat + plátno",
    tag: "první prototyp",
    text: "Úzký chat vlevo, velké výstupy v záložkách vpravo. Nejvíc místa pro grafy, ale dvě místa, kam se dívat.",
  },
];

export default function LabIndex() {
  return (
    <div className="lab">
      <header>
        <h1>Varianty rozložení</h1>
        <p>Všechny běží na stejných demo datech a stejném A2UI rendereru. Liší se jen rozložením.</p>
      </header>
      <ul>
        {VARIANTS.map((v) => (
          <li key={v.href}>
            <a href={v.href}>
              <span className="lab-tag">{v.tag}</span>
              <strong>{v.name}</strong>
              <span>{v.text}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="lab-foot">
        <a href="/">Zpět na úvod</a> · <a href="/design">Design systém</a>
      </p>
    </div>
  );
}
