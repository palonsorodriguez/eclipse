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
  marginTop: "3rem",
};

const estiloTitulo: CSSProperties = {
  fontSize: "1.4rem",
  marginBottom: "0.75rem",
};

const estiloSubtitulo: CSSProperties = {
  fontSize: "1.05rem",
  marginTop: "1.75rem",
  marginBottom: "0.5rem",
  opacity: 0.9,
};

const estiloAviso: CSSProperties = {
  border: "1px solid rgba(255, 200, 120, 0.45)",
  background: "rgba(255, 200, 120, 0.08)",
  borderRadius: "0.5rem",
  padding: "1rem 1.25rem",
};

export default function Info() {
  return (
    <main
      style={{
        maxWidth: "42rem",
        margin: "0 auto",
        padding: "3rem 1.5rem 5rem",
        lineHeight: 1.65,
      }}
    >
      <Link href="/" style={{ color: "#ffe9a8", fontSize: "0.95rem" }}>
        ← Volver al simulador
      </Link>

      <h1 style={{ fontSize: "1.9rem", marginTop: "1.5rem" }}>
        El eclipse del 12 de agosto de 2026
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
