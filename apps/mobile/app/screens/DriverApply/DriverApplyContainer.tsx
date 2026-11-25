import {
  applyDriverSchema,
  type ApplyDriver,
  type VehicleType,
  vehicleTypeSchema,
} from '@lern/contracts';
import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import { ApiError } from '../../services/api.service';
import DriverApplyScreen from './DriverApplyScreen';

type Errors = {
  vehicle?: boolean;
  plate?: boolean;
  submit?: 'auth.offline' | 'driverApply.error';
};

export default function DriverApplyContainer({
  becomeDriver,
}: {
  becomeDriver(input: ApplyDriver): Promise<void>;
}) {
  const t = useT();
  const [vehicleType, setVehicleType] = useState<VehicleType>();
  const [plate, setPlate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  async function send() {
    if (sending.current) return;
    const parsed = applyDriverSchema.safeParse({ vehicleType, plate });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      setErrors({
        vehicle: issues.some(issue => issue.path[0] === 'vehicleType'),
        plate: issues.some(issue => issue.path[0] === 'plate'),
      });
      return;
    }

    sending.current = true;
    setBusy(true);
    setErrors({});
    try {
      await becomeDriver(parsed.data);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 400) setErrors({ plate: true });
      else
        setErrors({
          submit: status === 0 ? 'auth.offline' : 'driverApply.error',
        });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <DriverApplyScreen
      vehicleType={vehicleType}
      vehicleLabel={t('driverApply.vehicle')}
      vehicles={vehicleTypeSchema.options.map(value => ({
        value,
        label: t(`driverApply.${value}`),
        hint: t(`driverApply.${value}.hint`),
      }))}
      vehicleError={errors.vehicle ? t('driverApply.vehicleError') : undefined}
      plate={plate}
      plateLabel={t('driverApply.plate')}
      plateError={errors.plate ? t('driverApply.plateError') : undefined}
      nextSteps={t('driverApply.nextSteps')}
      submitLabel={t('driverApply.submit')}
      submitError={errors.submit && t(errors.submit)}
      busy={busy}
      onVehicleChange={value => {
        setVehicleType(value);
        setErrors(previous => ({ ...previous, vehicle: undefined }));
      }}
      onPlateChange={value => {
        setPlate(value);
        setErrors(previous => ({ ...previous, plate: undefined }));
      }}
      onSubmit={send}
    />
  );
}
