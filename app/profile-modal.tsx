import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import NewUserProfileModal from '@/components/NewUserProfileModal';

export default function ProfileModalScreen() {
  const user = useSelector((state: RootState) => state.user);

  return (
    <NewUserProfileModal
      visible={user.isNewUser}
      preFillData={{
        name: user.name || undefined,
        email: user.email || undefined,
      }}
    />
  );
}
