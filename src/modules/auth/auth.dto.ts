import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class RegisterCustomerDto {
  @ApiProperty({ example: 'Siti Aminah' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'siti@ewallet.id' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '081299998888' })
  @IsString()
  @Matches(/^08[0-9]{8,12}$/, { message: 'Nomor HP harus format Indonesia (08xxxxxxxxxx)' })
  phoneNumber: string;

  @ApiProperty({ example: 'Rahasia123!' })
  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter' })
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'customer@ewallet.id' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Customer123!@#' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'customer@ewallet.id' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '081200000001' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: 'PasswordBaru123!' })
  @IsString()
  @MinLength(8, { message: 'Password baru minimal 8 karakter' })
  newPassword: string;
}
