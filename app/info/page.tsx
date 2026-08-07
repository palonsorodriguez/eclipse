import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { VENTANA_TOTALIDAD } from "@/lib/eclipse-2026";

export const metadata: Metadata = {
  title: "Información y seguridad — Eclipse del 12 de agosto de 2026",
  description:
    "Qué pasa el 12 de agosto de 2026, cómo observar el eclipse sin dañarte la vista y de dónde salen los datos de la app.",
};

const estiloSeccion: CSSProperties = {
  marginTop: "3.25rem",
};

const estiloTitulo: CSSProperties = {
  fontFamily: "var(--fuente-titulos), system-ui, sans-serif",
  fontSize: "1.5rem",
  fontWeight: 600,
  color: "#ffd97a",
  letterSpacing: "0.01em",
  borderBottom: "1px solid rgba(255, 217, 122, 0.25)",
  paddingBottom: "0.5rem",
  marginBottom: "1rem",
};

const estiloSubtitulo: CSSProperties = {
  fontFamily: "var(--fuente-titulos), system-ui, sans-serif",
  fontSize: "1.1rem",
  fontWeight: 600,
  color: "#f3edda",
  marginTop: "2rem",
  marginBottom: "0.5rem",
};

const estiloAviso: CSSProperties = {
  border: "1px solid rgba(255, 176, 92, 0.7)",
  borderLeft: "4px solid #ffb05c",
  background: "rgba(255, 176, 92, 0.12)",
  borderRadius: "0.5rem",
  padding: "1rem 1.25rem",
  color: "#f7edd8",
  fontSize: "1.02rem",
};

// Las negritas del texto van en ámbar suave en vez de blanco puro: destacan
// sin convertir cada párrafo en un damero de contraste.
const estiloDestacado: CSSProperties = {
  color: "#ffe1a1",
  fontWeight: 600,
};

const estiloEnlace: CSSProperties = {
  color: "#ffd97a",
  textDecorationColor: "rgba(255, 217, 122, 0.5)",
  textUnderlineOffset: "3px",
};

export default function Info() {
  return (
    <main
      className="pagina-info"
      style={{
        maxWidth: "40rem",
        margin: "0 auto",
        padding: "3rem 1.5rem 5rem",
        lineHeight: 1.7,
        fontSize: "1.04rem",
      }}
    >
      <style>{`
        .pagina-info strong { color: ${estiloDestacado.color}; font-weight: 600; }
        .pagina-info a {
          color: ${estiloEnlace.color};
          text-decoration-color: rgba(255, 217, 122, 0.5);
          text-underline-offset: 3px;
        }
        .pagina-info a:hover { text-decoration-color: #ffd97a; }
        .pagina-info ul { padding-left: 1.25rem; }
        .pagina-info li { margin-bottom: 0.6rem; }
        .pagina-info li::marker { color: #ffd97a; }
        .pagina-info p { margin: 0.85rem 0; }
      `}</style>
      <Link href="/" style={{ color: "#ffd97a", fontSize: "0.95rem" }}>
        ← Volver al simulador
      </Link>

      <h1
        style={{
          fontFamily: "var(--fuente-titulos), system-ui, sans-serif",
          fontSize: "2.1rem",
          fontWeight: 700,
          color: "#f6f3ff",
          marginTop: "1.5rem",
          lineHeight: 1.25,
        }}
      >
        El eclipse del{" "}
        <span style={{ color: "#ffd97a" }}>12 de agosto de 2026</span>
      </h1>

      <section style={estiloSeccion}>
        <h2 style={estiloTitulo}>Qué va a pasar</h2>
        <p>
          El <strong>12 de agosto de 2026</strong>, al atardecer, la Luna se
          interpondrá entre el Sol y España. Es el primer eclipse solar total
          visible desde la Península en más de un siglo.
        </p>
        <p>
          La <strong>Franja de totalidad</strong> —la banda de unos 300 km de
          ancho donde el Sol queda tapado por completo— entra por{" "}
          <strong>Galicia</strong> y cruza el país en diagonal hasta{" "}
          <strong>Baleares</strong>. Dentro de ella la Totalidad ocurre entre
          las <strong>{VENTANA_TOTALIDAD.inicio}</strong> y las{" "}
          <strong>{VENTANA_TOTALIDAD.fin}</strong> aproximadamente (hora
          peninsular). Cuánto dura depende de dónde estés: algo menos de dos
          minutos en el centro de la banda, y cada vez menos hacia los bordes,
          hasta quedarse en unos pocos segundos. Fuera de la Franja de totalidad
          el eclipse es parcial: el Sol se ve como una media luna, pero nunca
          desaparece del todo.
        </p>
        <p>
          Es un eclipse vespertino y con el Sol muy bajo: unos 12° sobre el
          horizonte en Galicia y apenas 2° en Baleares. Por eso hace falta{" "}
          <strong>horizonte oeste despejado</strong> —sin montañas, edificios ni
          nubes bajas— para llegar a verlo.
        </p>
      </section>

      <section style={estiloSeccion}>
        <h2 style={estiloTitulo}>Cómo observarlo con seguridad</h2>

        <p style={estiloAviso}>
          <strong>Nunca mires al Sol sin protección homologada</strong>, ni
          siquiera unos segundos y aunque esté casi tapado por la Luna. La
          retina no duele: el daño se produce sin que lo notes y puede ser
          permanente.
        </p>

        <h3 style={estiloSubtitulo}>Sí sirve</h3>
        <ul>
          <li>
            Gafas de eclipse certificadas <strong>ISO 12312-2</strong>, sin
            arañazos ni perforaciones. Póntelas antes de levantar la vista y no
            te las quites hasta después de apartarla.
          </li>
          <li>
            La <strong>proyección estenopeica</strong>: haz un agujero pequeño
            en una cartulina y deja que el Sol proyecte su imagen sobre otra
            superficie. Miras a la proyección, nunca al Sol. Un colador o la
            sombra de un árbol hacen el mismo efecto.
          </li>
        </ul>

        <h3 style={estiloSubtitulo}>No sirve</h3>
        <p>
          No valen las <strong>gafas de sol</strong> (por muchas que
          superpongas), las <strong>radiografías</strong>, los{" "}
          <strong>cristales ahumados</strong>, los filtros fotográficos ni los
          CD. Dejan pasar muchísima más luz visible e infrarroja de la que la
          retina aguanta: atenúan el deslumbramiento, que es lo que te avisa,
          pero no el daño.
        </p>
        <p>
          Tampoco mires por prismáticos, telescopio o cámara con las gafas de
          eclipse puestas: concentran tanta luz que atraviesan el filtro. Esos
          instrumentos necesitan su propio filtro solar delante del objetivo.
        </p>

        <h3 style={estiloSubtitulo}>La única excepción: la Totalidad</h3>
        <p>
          Dentro de la Franja de totalidad, y{" "}
          <strong>solo durante la Totalidad</strong> —entre los contactos C2 y
          C3, con el disco solar tapado al 100%—, se puede mirar a simple vista:
          es cuando se ve la corona. En cuanto asome el primer punto de luz,{" "}
          <strong>vuelve a ponerte las gafas</strong> inmediatamente.
        </p>
        <p>
          <strong>Fuera de la Franja de totalidad</strong> esa excepción no
          existe en ningún momento: aunque el Oscurecimiento llegue al 99%, el
          trozo de Sol que queda basta para dañar la vista. Si no sabes si tu
          municipio está dentro, no te la juegues y no te quites las gafas.
        </p>
      </section>

      <section style={estiloSeccion}>
        <h2 style={estiloTitulo}>Fuentes y créditos</h2>
        <p>
          La app está en construcción. Los horarios y el Oscurecimiento que
          llegue a mostrar se <strong>calculan</strong> para cada Observador a
          partir de efemérides; no se copian de tablas de prensa. Las cifras
          generales de esta página (la ventana de Totalidad, el ancho de la
          franja, las alturas del Sol) son las que publica el IGN para el
          conjunto de España.
        </p>
        <ul>
          <li>
            <a href="https://www.ign.es/">Instituto Geográfico Nacional</a>{" "}
            (IGN) —{" "}
            <em>
              Nomenclátor Geográfico de Municipios y Entidades de Población
            </em>
            : las coordenadas de los ~8.100 municipios españoles. Datos del IGN
            bajo licencia{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/deed.es">
              CC BY 4.0
            </a>
            .
          </li>
          <li>
            <a href="https://eclipse.gsfc.nasa.gov/">NASA</a> (Goddard Space
            Flight Center) — elementos y trayectoria de la sombra del eclipse
            del 12 de agosto de 2026, de donde se deriva la Franja de totalidad
            de la Vista Mapa. Dominio público.
          </li>
          <li>
            <a href="https://open-meteo.com/">Open-Meteo</a> — previsión de
            nubosidad por horas para el municipio elegido.
          </li>
        </ul>
        <p style={{ opacity: 0.75, fontSize: "0.95rem" }}>
          Proyecto divulgativo sin ánimo de lucro. Los cálculos y la previsión
          meteorológica se ofrecen sin garantía; para cualquier decisión sobre
          observación segura manda siempre la advertencia de arriba.
        </p>
      </section>
    </main>
  );
}
