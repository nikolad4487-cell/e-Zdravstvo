import { Link } from "react-router-dom";
import { Brand } from "../components/ui/Brand";
import { Disclaimer } from "../components/ui/Feedback";
export function InformationPage({
  kind,
}: {
  kind: "setup" | "privacy" | "about";
}) {
  return (
    <main className="standalone wide">
      <Brand />
      <span className="eyebrow">e-ZDRAVSTVO / FAZA 1</span>
      <h1>
        {kind === "setup"
          ? "Povežite svoj radni prostor."
          : kind === "privacy"
            ? "Privatnost od samog početka."
            : "Integrirani digitalni zdravstveni sustav."}
      </h1>
      {kind === "setup" ? (
        <>
          <p>
            Aplikacija koristi stvarni Supabase backend. Za pokretanje slijedite
            README u projektu.
          </p>
          <ol>
            <li>
              Pokrenite lokalni Supabase uz Docker ili povežite razvojni
              Supabase projekt.
            </li>
            <li>
              Primijenite SQL migracije naredbom <code>supabase db reset</code>{" "}
              lokalno ili <code>supabase db push</code> za povezani projekt.
            </li>
            <li>
              Kopirajte <code>.env.example</code> u <code>.env</code> i upišite
              URL i javni ključ projekta.
            </li>
            <li>
              Za testne račune pripremite <code>.env.seed</code> prema primjeru
              i pokrenite <code>npm run seed:demo</code>.
            </li>
            <li>Ponovno pokrenite Vite i prijavite se testnim računom.</li>
          </ol>
          <p>
            Privilegirani Supabase ključ služi isključivo lokalnoj seed skripti.
            Nikada ga ne unosite u varijablu s prefiksom VITE_.
          </p>
        </>
      ) : kind === "privacy" ? (
        <>
          <p>
            Pristup se provjerava na svakoj zaštićenoj ruti i u bazi kroz Row
            Level Security. Svaki račun može imati više uloga.
          </p>
          <p>
            Medicinski podaci ne spremaju se u localStorage. Opcija „Zapamti me”
            sprema samo podatke autentikacijske sesije. Koristite je samo na
            vlastitom uređaju.
          </p>
          <p>
            Faza 1 ne obrađuje medicinsku dokumentaciju. Testni računi i
            ustanova koriste isključivo izmišljene podatke. Sustav nije spreman
            za obradu stvarnih zdravstvenih podataka.
          </p>
        </>
      ) : (
        <>
          <p>
            e-Zdravstvo povezuje radne prostore zdravstvenih djelatnika,
            ustanova i građana putem zajedničke autentikacije i baze.
          </p>
          <p>
            U prvoj fazi dostupni su prijava, obnova lozinke, korisničke uloge,
            zaštićeni portali i temelj sigurnosne evidencije.
          </p>
          <p>
            Kartoni pacijenata i klinički moduli dolaze u sljedećim fazama.
            Funkcionalnosti će se uvoditi kao cjeloviti tokovi rada.
          </p>
        </>
      )}
      <Disclaimer />
      <Link className="back-link" to="/">
        ← Natrag na početnu
      </Link>
    </main>
  );
}
