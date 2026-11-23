import { useState } from 'react';

export function FhirView({ bundle }: { bundle: any }) {
  const [raw, setRaw] = useState(false);
  if (bundle?.card) {
    const e = bundle.card;
    return (
      <div className="rounded-md border border-rose/40 bg-rose/5 p-4 fade-in">
        <div className="label text-rose">Emergency card</div>
        <div className="text-xl font-bold mt-1">{e.patientName}</div>
        <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
          <div>
            <div className="label">Blood group</div>
            <div className="text-2xl font-extrabold text-rose">{e.bloodGroup}</div>
          </div>
          <div>
            <div className="label">Allergies</div>
            <div className="font-semibold">{e.allergies.join(', ')}</div>
          </div>
          <div>
            <div className="label">Conditions</div>
            <div>{e.conditions.join(', ')}</div>
          </div>
          <div>
            <div className="label">Medications</div>
            <div>{e.medications.join(', ')}</div>
          </div>
          <div className="col-span-2">
            <div className="label">Emergency contact</div>
            <div>{e.emergencyContact}</div>
          </div>
        </div>
      </div>
    );
  }
  const res = (t: string) => (bundle?.entry ?? []).map((e: any) => e.resource).filter((r: any) => r.resourceType === t);
  const cond = res('Condition')[0];
  const proc = res('Procedure')[0];
  const org = res('Organization')[0];
  const claim = res('Claim')[0];
  return (
    <div className="rounded-md border border-line bg-panel2 p-4 text-sm fade-in">
      <div className="flex justify-between items-center">
        <div className="label">FHIR R4 Bundle · decrypted on this device</div>
        <button className="text-xs text-violet" onClick={() => setRaw(!raw)}>
          {raw ? 'summary' : 'raw JSON'}
        </button>
      </div>
      {raw ? (
        <pre className="mono text-[11px] mt-2 max-h-72 overflow-auto">{JSON.stringify(bundle, null, 2)}</pre>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Row k="Facility" v={`${org?.name ?? '—'} (HFR ${org?.identifier?.[0]?.value ?? '—'})`} />
          <Row k="Date" v={cond?.recordedDate ?? proc?.performedDateTime} />
          <Row k="Diagnosis (ICD-10)" v={cond && `${cond.code.coding[0].code} · ${cond.code.coding[0].display}`} />
          <Row k="Procedure" v={proc && `${proc.code.coding[0].code} · ${proc.code.coding[0].display}`} />
          <Row k="Medications" v={res('MedicationRequest').map((m: any) => m.medicationCodeableConcept.text).join(', ')} />
          <Row k="Allergies" v={res('AllergyIntolerance').map((m: any) => m.code.text).join(', ')} />
          <Row k="Observations" v={res('Observation').map((o: any) => `${o.code.coding[0].display} ${o.valueQuantity.value}${o.valueQuantity.unit}`).join(', ')} />
          <Row k="Bill total" v={claim && `₹${claim.total.value.toLocaleString('en-IN')}`} />
        </div>
      )}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: any }) => (
  <div>
    <div className="label">{k}</div>
    <div className="mt-0.5">{v || '—'}</div>
  </div>
);
