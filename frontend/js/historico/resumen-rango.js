// Totales del rango completo, independientes de los filtros de semana y zona.
import { API_BASE } from '../constantes.js';
import { escaparHtml } from '../utilidades.js';
import { formatearLitros, formatearPesos } from '../kia/colores-consumo.js';

export function resumirRecorridos(recorridos, conMedido) {
    return recorridos.filter(r => r.emulado !== true).reduce((total, r) => {
        total.cantidad++;
        total.litros += r.litros ?? 0;
        total.costo += r.costo_cop ?? 0;
        if (conMedido) {
            total.litrosMedidos += r.litros_medidos ?? 0;
            total.costoMedido += r.costo_medido_cop ?? 0;
        }
        return total;
    }, { cantidad: 0, litros: 0, costo: 0, litrosMedidos: 0, costoMedido: 0 });
}

function pintarResumen(contenedor, datos, conMedido) {
    const recorridos = datos.recorridos;
    const total = resumirRecorridos(recorridos, conMedido);
    const emulados = recorridos.filter(r => r.emulado === true).length;
    const hayMedido = conMedido && recorridos.some(r => r.emulado !== true
        && (r.litros_medidos != null || r.costo_medido_cop != null));
    contenedor.innerHTML = '<div class="tituloMetricas">RESUMEN DEL RANGO</div>'
        + (total.cantidad === 0
            ? '<div>Sin recorridos con estimado en este rango</div>'
                + (emulados > 0 ? `<small>(${emulados} emulado(s) sin contar)</small>` : '')
            : `<div>${total.cantidad} recorrido(s) · ${escaparHtml(formatearLitros(total.litros))} · ${escaparHtml(formatearPesos(total.costo))}</div>`
                + '<small>estimado del modelo</small>')
        + (hayMedido ? `<div>Medido: ${escaparHtml(formatearLitros(total.litrosMedidos))} · ${escaparHtml(formatearPesos(total.costoMedido))}</div>` : '')
        + (datos.truncado ? '<small>(resumen parcial: demasiados puntos en el rango)</small>' : '');
}

export function initResumenRango() {
    let consulta = 0;
    const destinos = [
        { id: 'resumenApp', vid: 'celular', conMedido: false },
        { id: 'resumenKia', vid: 'kia_k3', conMedido: true }
    ];
    document.addEventListener('historico:busqueda', evento => {
        const numero = ++consulta;
        const { desde, hasta } = evento.detail;
        destinos.forEach(async ({ id, vid, conMedido }) => {
            const contenedor = document.getElementById(id);
            if (!contenedor) return;
            contenedor.hidden = false;
            contenedor.style.color = '';
            contenedor.innerHTML = '<div class="tituloMetricas">RESUMEN DEL RANGO</div><div>Calculando resumen…</div>';
            try {
                const parametros = new URLSearchParams({ vid, desde, hasta });
                const respuesta = await fetch(`${API_BASE}/api/recorridos?${parametros}`);
                if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
                const datos = await respuesta.json();
                if (numero !== consulta) return;
                pintarResumen(contenedor, datos, conMedido);
            } catch (error) {
                if (numero !== consulta) return;
                contenedor.innerHTML = '<div class="tituloMetricas">RESUMEN DEL RANGO</div><div>No se pudo calcular el resumen</div>';
                contenedor.style.color = '#e74c3c';
                console.error('[Resumen] Error consultando el rango:', error);
            }
        });
    });
    new MutationObserver(() => {
        if (document.body.classList.contains('modoHistorico')) return;
        consulta++; // Invalida también las consultas pendientes al salir del histórico.
        destinos.forEach(({ id }) => {
            const contenedor = document.getElementById(id);
            if (contenedor) {
                contenedor.hidden = true;
                contenedor.innerHTML = '';
            }
        });
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
